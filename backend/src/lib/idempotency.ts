// Optional Idempotency-Key handling (FR2.6, D7): the same key with the same body returns the same plan; the same
// key with a different body is a conflict. One item per key, holding a hash of the body, expires after 24 hours.
import { createHash } from 'node:crypto';
import { IDEMPOTENCY_TTL_HOURS } from '@jarvel/shared';
import { DeleteCommand, GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { epochSeconds, idempotencySk, isConditionalCheckFailed, userPk, writeUnlessDeleted } from './dynamo.js';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * A claim older than this has finished its request one way or another: ApiFn runs for at most 15 s and the HTTP
 * API waits at most 30 s. If its plan is missing after that, the plan was never stored or was deleted.
 */
export const CLAIM_SETTLE_SECONDS = 30;

/**
 * `settled` on a replay says the claiming request has finished (see CLAIM_SETTLE_SECONDS). A settled replay whose
 * plan is missing may be taken over with `takeOver`; an unsettled one is still in progress.
 */
export type IdempotencyClaim =
  { outcome: 'new' } | { outcome: 'replay'; planId: string; settled: boolean } | { outcome: 'conflict' };

function claimedAtOf(item: Record<string, unknown>): number {
  if (typeof item.claimedAt === 'number') return item.claimedAt;
  return Number(item.expiresAt) - IDEMPOTENCY_TTL_HOURS * 3600;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** SHA-256 of the body's canonical JSON (keys sorted), so key order does not change the hash. */
export function requestHash(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(body)))
    .digest('hex');
}

export class IdempotencyStore {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /**
   * Claims `key` for `planId`. A live claim with the same body hash is a replay of its plan; with a different
   * hash it is a conflict. An expired claim (TTL deletion can lag) is taken over as new.
   */
  async claim(userId: string, key: string, bodyHash: string, planId: string, now: Date): Promise<IdempotencyClaim> {
    const nowSeconds = epochSeconds(now);
    try {
      // Never written for an account whose deletion has started (R-08): AccountDeletedError instead.
      await writeUnlessDeleted(this.doc, this.tableName, userId, {
        Put: {
          TableName: this.tableName,
          Item: this.claimItem(userId, key, bodyHash, planId, nowSeconds),
          ConditionExpression: 'attribute_not_exists(sk) OR #expiresAt <= :now',
          ExpressionAttributeNames: { '#expiresAt': 'expiresAt' },
          ExpressionAttributeValues: { ':now': nowSeconds },
        },
      });
      return { outcome: 'new' };
    } catch (error) {
      if (!isConditionalCheckFailed(error)) throw error;
    }
    const existing = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: userPk(userId), sk: idempotencySk(key) },
        ConsistentRead: true,
      }),
    );
    const item = existing.Item;
    if (!item) return { outcome: 'conflict' }; // claimed and released in between: ask the client to retry
    if (item.bodyHash !== bodyHash) return { outcome: 'conflict' };
    const settled = claimedAtOf(item) + CLAIM_SETTLE_SECONDS <= nowSeconds;
    return { outcome: 'replay', planId: String(item.planId), settled };
  }

  /**
   * Releases a settled claim whose plan was never stored or was deleted by handing the key to a new request for
   * `planId`, so a retry is treated as new instead of being refused for 24 hours. The write only succeeds while
   * the key still guards `stalePlanId`, so when two retries race only one takes the key over.
   */
  async takeOver(
    userId: string,
    key: string,
    claim: { bodyHash: string; stalePlanId: string; planId: string },
    now: Date,
  ): Promise<boolean> {
    try {
      await writeUnlessDeleted(this.doc, this.tableName, userId, {
        Put: {
          TableName: this.tableName,
          Item: this.claimItem(userId, key, claim.bodyHash, claim.planId, epochSeconds(now)),
          ConditionExpression: '#planId = :stale',
          ExpressionAttributeNames: { '#planId': 'planId' },
          ExpressionAttributeValues: { ':stale': claim.stalePlanId },
        },
      });
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
  }

  private claimItem(userId: string, key: string, bodyHash: string, planId: string, nowSeconds: number) {
    return {
      pk: userPk(userId),
      sk: idempotencySk(key),
      entity: 'idempotency',
      bodyHash,
      planId,
      claimedAt: nowSeconds,
      expiresAt: nowSeconds + IDEMPOTENCY_TTL_HOURS * 3600,
    };
  }

  /** Releases a claim when the request it guarded was not accepted (e.g. refused by the monthly limit). */
  async release(userId: string, key: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.tableName, Key: { pk: userPk(userId), sk: idempotencySk(key) } }),
    );
  }
}
