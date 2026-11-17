// Plan records in the single DynamoDB table (D5): owner-scoped reads (FR1.5), guarded status transitions (FR2.4),
// deletion (FR8, FR8.1) and retention 90 days after departure (FR8.2).
import { PLAN_RETENTION_DAYS, type PlanRecord, type PlanStatus } from '@jarvel/shared';
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  DELETED_SK,
  epochSeconds,
  isConditionalCheckFailed,
  planSk,
  userPk,
  writeUnlessDeleted,
  type UpdateOperation,
} from './dynamo.js';
import { addDays, bostonLocalToInstant, splitLocalDateTime } from './time.js';

/** For each target status, the statuses a plan may move from. QUEUED is only ever the first status. */
export const ALLOWED_TRANSITIONS: Record<PlanStatus, readonly PlanStatus[]> = {
  QUEUED: [],
  RUNNING: ['QUEUED'],
  SUCCEEDED: ['RUNNING'],
  FAILED: ['QUEUED', 'RUNNING'],
};

export class IllegalTransitionError extends Error {
  constructor(readonly to: PlanStatus) {
    super(`No plan may move to ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export type PlanPatch = Partial<Omit<PlanRecord, 'userId' | 'planId' | 'status' | 'createdAt'>>;

const KEY_ATTRIBUTES = ['pk', 'sk', 'entity', 'expiresAt'] as const;
const MAX_BATCH = 25;
const MAX_BATCH_ATTEMPTS = 5;
/**
 * How long the deleted-account marker is kept. Its only job is to refuse requests that still carry a valid access
 * token, which lasts at most 1 hour after the person is signed out everywhere (D8). Two hours covers that with a
 * margin; after it nothing in the table names the deleted user id (AC6.3.2), apart from DynamoDB's own delay in
 * removing expired items (R-07).
 */
export const DELETED_MARKER_HOURS = 2;

/** The TTL of a plan: its departure date-time plus 90 days, in epoch seconds (FR8.2). */
export function planExpiresAt(departure: string): number {
  const { date, minutes } = splitLocalDateTime(departure);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return epochSeconds(bostonLocalToInstant(`${addDays(date, PLAN_RETENTION_DAYS)}T${hh}:${mm}`));
}

function toRecord(item: Record<string, unknown>): PlanRecord {
  const copy = { ...item };
  for (const key of KEY_ATTRIBUTES) delete copy[key];
  return copy as unknown as PlanRecord;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class PlanStore {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Stores a new plan. Fails if a plan with the same id already exists for the user. */
  async createPlan(record: PlanRecord): Promise<void> {
    // Never stored for an account whose deletion has started (R-08): AccountDeletedError instead.
    await writeUnlessDeleted(this.doc, this.tableName, record.userId, {
      Put: {
        TableName: this.tableName,
        Item: {
          pk: userPk(record.userId),
          sk: planSk(record.planId),
          entity: 'plan',
          expiresAt: planExpiresAt(record.request.departure),
          ...record,
        },
        ConditionExpression: 'attribute_not_exists(sk)',
      },
    });
  }

  /** The caller's plan, or undefined when it does not exist, belongs to someone else, or has expired. */
  async getPlan(userId: string, planId: string): Promise<PlanRecord | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: userPk(userId), sk: planSk(planId) },
        ConsistentRead: true,
      }),
    );
    const item = result.Item;
    if (!item || this.isExpired(item)) return undefined;
    return toRecord(item);
  }

  /** The caller's unexpired plans, newest first. Reads every page of the owner's plan items. */
  async listPlans(userId: string): Promise<PlanRecord[]> {
    const plans: PlanRecord[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': userPk(userId), ':prefix': 'PLAN#' },
          ConsistentRead: true,
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of page.Items ?? []) if (!this.isExpired(item)) plans.push(toRecord(item));
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    // Newest first; plans created in the same millisecond keep a fixed order by plan id (FR13's stable tie-break).
    return plans.sort((a, b) =>
      a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.planId < b.planId ? -1 : 1,
    );
  }

  /** Renames the caller's plan in any status. Returns false when there is no such (unexpired) plan. */
  async renamePlan(userId: string, planId: string, title: string): Promise<boolean> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: userPk(userId), sk: planSk(planId) },
          UpdateExpression: 'SET #title = :title, #updatedAt = :updatedAt',
          // A plan past its retention time is gone for get and list even before DynamoDB's TTL removes it (R-10).
          ConditionExpression: 'attribute_exists(sk) AND (attribute_not_exists(#expiresAt) OR #expiresAt > :now)',
          ExpressionAttributeNames: { '#title': 'title', '#updatedAt': 'updatedAt', '#expiresAt': 'expiresAt' },
          ExpressionAttributeValues: {
            ':title': title,
            ':updatedAt': this.now().toISOString(),
            ':now': epochSeconds(this.now()),
          },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
  }

  /**
   * Moves a plan to `to` and applies `patch`, only from a status allowed by ALLOWED_TRANSITIONS.
   * Returns false when the plan is missing or not in an allowed status (someone else already moved it).
   */
  async transitionPlan(userId: string, planId: string, to: PlanStatus, patch: PlanPatch = {}): Promise<boolean> {
    try {
      await this.doc.send(new UpdateCommand(this.transitionOperation(userId, planId, to, patch)));
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
  }

  /**
   * The guarded update behind transitionPlan, without sending it, so it can be one write of a transaction
   * (a FAILED transition together with its refund, FR6.1).
   */
  transitionOperation(userId: string, planId: string, to: PlanStatus, patch: PlanPatch = {}): UpdateOperation {
    const from = ALLOWED_TRANSITIONS[to];
    if (from.length === 0) throw new IllegalTransitionError(to);
    const names: Record<string, string> = { '#status': 'status', '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = { ':to': to, ':updatedAt': this.now().toISOString() };
    const sets = ['#status = :to', '#updatedAt = :updatedAt'];
    Object.entries(patch).forEach(([key, value], index) => {
      if (value === undefined) return;
      names[`#p${index}`] = key;
      values[`:p${index}`] = value;
      sets.push(`#p${index} = :p${index}`);
    });
    from.forEach((status, index) => (values[`:from${index}`] = status));
    const allowed = from.map((_, index) => `:from${index}`).join(', ');
    return {
      TableName: this.tableName,
      Key: { pk: userPk(userId), sk: planSk(planId) },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: `attribute_exists(sk) AND #status IN (${allowed})`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    };
  }

  /**
   * Writes the deleted-account marker for a user id (FR8.1). It holds no email or other personal data, only the
   * id the API must refuse and when that started. Writing it again (a re-run of the cleanup) is harmless.
   */
  async markAccountDeleted(userId: string): Promise<void> {
    const now = this.now();
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: userPk(userId),
          sk: DELETED_SK,
          entity: 'deleted-account',
          deletedAt: now.toISOString(),
          expiresAt: epochSeconds(now) + DELETED_MARKER_HOURS * 3600,
        },
      }),
    );
  }

  /** True when the user id belongs to a deleted account, so the API must refuse it (FR8.1). */
  async isAccountDeleted(userId: string): Promise<boolean> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: userPk(userId), sk: DELETED_SK },
        ConsistentRead: true,
      }),
    );
    return result.Item !== undefined;
  }

  /** Records build progress while the plan is RUNNING (AC3.1.1). Returns false once it is no longer RUNNING. */
  async updateProgress(userId: string, planId: string, progress: PlanRecord['progress']): Promise<boolean> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: userPk(userId), sk: planSk(planId) },
          UpdateExpression: 'SET #progress = :progress, #updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(sk) AND #status IN (:running)',
          ExpressionAttributeNames: { '#progress': 'progress', '#updatedAt': 'updatedAt', '#status': 'status' },
          ExpressionAttributeValues: {
            ':progress': progress,
            ':updatedAt': this.now().toISOString(),
            ':running': 'RUNNING',
          },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
  }

  /** Deletes the caller's plan. Returns false when there was no such (unexpired) plan. Never refunds (FR8.3). */
  async deletePlan(userId: string, planId: string): Promise<boolean> {
    const result = await this.doc.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: userPk(userId), sk: planSk(planId) },
        ReturnValues: 'ALL_OLD',
      }),
    );
    return result.Attributes !== undefined && !this.isExpired(result.Attributes);
  }

  /**
   * Deletes every plan and idempotency item of a user (FR8.1). Quota items are left in place for the
   * account-deletion flow to move into a hold keyed by email hash (see QuotaStore.holdForDeletedAccount).
   */
  async deleteAllForUser(userId: string): Promise<{ plans: number; idempotencyKeys: number }> {
    const keys = await this.listKeys(userId);
    const doomed = keys.filter((key) => key.sk.startsWith('PLAN#') || key.sk.startsWith('IDEM#'));
    for (let start = 0; start < doomed.length; start += MAX_BATCH) {
      await this.batchDelete(doomed.slice(start, start + MAX_BATCH));
    }
    return {
      plans: doomed.filter((key) => key.sk.startsWith('PLAN#')).length,
      idempotencyKeys: doomed.filter((key) => key.sk.startsWith('IDEM#')).length,
    };
  }

  private isExpired(item: Record<string, unknown>): boolean {
    return typeof item.expiresAt === 'number' && item.expiresAt <= epochSeconds(this.now());
  }

  private async listKeys(userId: string): Promise<{ pk: string; sk: string }[]> {
    const keys: { pk: string; sk: string }[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': userPk(userId) },
          ProjectionExpression: 'pk, sk',
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of page.Items ?? []) keys.push({ pk: String(item.pk), sk: String(item.sk) });
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return keys;
  }

  private async batchDelete(keys: { pk: string; sk: string }[]): Promise<void> {
    let pending = keys.map((Key) => ({ DeleteRequest: { Key } }));
    for (let attempt = 1; pending.length > 0; attempt += 1) {
      if (attempt > MAX_BATCH_ATTEMPTS) {
        throw new Error(`Could not delete ${pending.length} item(s) after ${MAX_BATCH_ATTEMPTS} attempts`);
      }
      const result = await this.doc.send(new BatchWriteCommand({ RequestItems: { [this.tableName]: pending } }));
      pending = (result.UnprocessedItems?.[this.tableName] ?? []) as typeof pending;
      if (pending.length > 0) await sleep(50 * 2 ** attempt);
    }
  }
}
