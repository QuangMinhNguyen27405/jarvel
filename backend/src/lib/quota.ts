// The 3-plans-a-month limit (FR6), counted per Boston calendar month. Reservation is one conditional update, so
// requests sent at the same moment cannot get past the limit (FR6.3). Faults on our side refund (FR6.1, D6).
import { createHash } from 'node:crypto';
import { MONTHLY_PLAN_LIMIT } from '@jarvel/shared';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  cancellationCodes,
  conflictRetryDelayMs,
  epochSeconds,
  heldQuotaPk,
  isConditionalCheckFailed,
  quotaSk,
  userPk,
  writeUnlessDeleted,
  type UpdateOperation,
} from './dynamo.js';
import { addDays, bostonLocalToInstant, bostonMonthKey, firstOfNextMonth } from './time.js';

export type QuotaReservation =
  | { accepted: true; month: string; used: number }
  | { accepted: false; month: string; used: number; limit: number; resetsOn: string };

/**
 * What happened to a status change sent together with its refund:
 * - `refunded`: both were applied;
 * - `not-moved`: the status change was refused (someone else already moved the plan), so nothing was applied;
 * - `nothing-to-refund`: the status change was allowed but the month has no count to give back, so nothing was
 *   applied and the caller may apply the status change alone.
 */
export type RefundOutcome = 'refunded' | 'not-moved' | 'nothing-to-refund';

/** A transaction that collided with another one on the same item is retried this many times in total. */
const MAX_TRANSACTION_ATTEMPTS = 3;

/** Quota items are kept until a week after their month resets, then DynamoDB removes them. */
function quotaExpiresAt(month: string): number {
  return epochSeconds(bostonLocalToInstant(`${addDays(firstOfNextMonth(month), 7)}T00:00`));
}

/** One-way hash of a normalised email, used only to carry a deleted account's count to a re-invite (D6). */
export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export class QuotaStore {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly limit: number = MONTHLY_PLAN_LIMIT,
  ) {}

  /** Counts one plan in the Boston month of `now`, unless the limit is already reached. */
  async reserve(userId: string, now: Date): Promise<QuotaReservation> {
    const month = bostonMonthKey(now);
    try {
      // Never counted for an account whose deletion has started (R-08): AccountDeletedError instead.
      await writeUnlessDeleted(this.doc, this.tableName, userId, {
        Update: {
          TableName: this.tableName,
          Key: { pk: userPk(userId), sk: quotaSk(month) },
          UpdateExpression: 'SET #expiresAt = :expiresAt ADD #count :one',
          ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
          ExpressionAttributeNames: { '#count': 'count', '#expiresAt': 'expiresAt' },
          ExpressionAttributeValues: { ':one': 1, ':limit': this.limit, ':expiresAt': quotaExpiresAt(month) },
        },
      });
      // A transaction cannot return the new count, so it is read back (a request at the same moment may show in it).
      return { accepted: true, month, used: await this.used(userId, month) };
    } catch (error) {
      if (!isConditionalCheckFailed(error)) throw error;
      const used = await this.used(userId, month);
      return { accepted: false, month, used, limit: this.limit, resetsOn: firstOfNextMonth(month) };
    }
  }

  /** Gives one count back in `month`. Returns false when there was nothing to give back. */
  async refund(userId: string, month: string): Promise<boolean> {
    try {
      await this.doc.send(new UpdateCommand(this.refundOperation(userId, month)));
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
  }

  /**
   * Applies `transition` (a guarded plan status change) and gives one count back in `month` in one
   * TransactWriteItems call, so either both happen or neither does (FR6.1). Because the refund only ever rides
   * on the caller that wins the status change, a plan is never refunded twice.
   */
  async refundWithTransition(transition: UpdateOperation, userId: string, month: string): Promise<RefundOutcome> {
    const refund = this.refundOperation(userId, month);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.doc.send(new TransactWriteCommand({ TransactItems: [{ Update: transition }, { Update: refund }] }));
        return 'refunded';
      } catch (error) {
        const codes = cancellationCodes(error);
        if (!codes) throw error;
        if (codes[0] === 'ConditionalCheckFailed') return 'not-moved';
        if (codes[1] === 'ConditionalCheckFailed' && codes[0] === 'None') return 'nothing-to-refund';
        const conflict = codes.includes('TransactionConflict');
        if (!conflict || attempt >= MAX_TRANSACTION_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, conflictRetryDelayMs(attempt)));
      }
    }
  }

  /** The conditional update behind refund: one count back, never below zero. */
  private refundOperation(userId: string, month: string): UpdateOperation {
    return {
      TableName: this.tableName,
      Key: { pk: userPk(userId), sk: quotaSk(month) },
      UpdateExpression: 'ADD #count :minusOne',
      ConditionExpression: '#count > :zero',
      ExpressionAttributeNames: { '#count': 'count' },
      ExpressionAttributeValues: { ':minusOne': -1, ':zero': 0 },
    };
  }

  /** How many plans count against `month` for the user. */
  async used(userId: string, month: string): Promise<number> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: userPk(userId), sk: quotaSk(month) },
        ConsistentRead: true,
      }),
    );
    return Number(result.Item?.count ?? 0);
  }

  /**
   * Account deletion (FR8.1, D6): moves the user's counts for the current and later months into a hold keyed
   * by the email hash, then deletes every quota item keyed by the user id. Returns the count held for `now`'s month.
   */
  async holdForDeletedAccount(userId: string, emailHash: string, now: Date): Promise<number> {
    const currentMonth = bostonMonthKey(now);
    let heldNow = 0;
    for (const item of await this.quotaItems(userId)) {
      const month = String(item.sk).slice('QUOTA#'.length);
      const count = Number(item.count ?? 0);
      if (month >= currentMonth && count > 0) {
        await this.doc.send(
          new PutCommand({
            TableName: this.tableName,
            Item: { pk: heldQuotaPk(emailHash), sk: quotaSk(month), count, expiresAt: quotaExpiresAt(month) },
          }),
        );
        if (month === currentMonth) heldNow = count;
      }
      await this.doc.send(new DeleteCommand({ TableName: this.tableName, Key: { pk: item.pk, sk: item.sk } }));
    }
    return heldNow;
  }

  /**
   * A cleanup re-run by user id alone (no email, so no hold can be keyed): deletes every quota item still keyed
   * by the user id, for example one written by a request that was in flight during the first cleanup.
   * Returns how many items were removed.
   */
  async removeForDeletedAccount(userId: string): Promise<number> {
    const items = await this.quotaItems(userId);
    for (const item of items) {
      await this.doc.send(new DeleteCommand({ TableName: this.tableName, Key: { pk: item.pk, sk: item.sk } }));
    }
    return items.length;
  }

  /** Every quota item of the user, reading every page of the query. */
  private async quotaItems(userId: string): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': userPk(userId), ':prefix': 'QUOTA#' },
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...(page.Items ?? []));
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  /** Re-invite (D6): seeds the new user's current-month count from a held count, then removes the hold. */
  async restoreHeld(userId: string, emailHash: string, now: Date): Promise<number> {
    const month = bostonMonthKey(now);
    const held = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { pk: heldQuotaPk(emailHash), sk: quotaSk(month) } }),
    );
    const count = Number(held.Item?.count ?? 0);
    if (count <= 0) return 0;
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { pk: userPk(userId), sk: quotaSk(month), count, expiresAt: quotaExpiresAt(month) },
      }),
    );
    await this.doc.send(
      new DeleteCommand({ TableName: this.tableName, Key: { pk: heldQuotaPk(emailHash), sk: quotaSk(month) } }),
    );
    return count;
  }
}
