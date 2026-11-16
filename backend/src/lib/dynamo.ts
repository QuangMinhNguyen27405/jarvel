// DynamoDB single-table keys (D5) and small helpers shared by the store, quota and idempotency modules.
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

export const userPk = (userId: string): string => `USER#${userId}`;
export const planSk = (planId: string): string => `PLAN#${planId}`;
export const quotaSk = (monthKey: string): string => `QUOTA#${monthKey}`;
export const idempotencySk = (key: string): string => `IDEM#${key}`;
/** Quota counts of a deleted account, keyed by a one-way hash of the email, never by the user id (D6). */
export const heldQuotaPk = (emailHash: string): string => `HOLD#${emailHash}`;
/** Sort key of the marker that says an account was deleted (FR8.1): its user id may no longer use the API. */
export const DELETED_SK = 'DELETED';

/** One conditional UpdateItem, usable on its own or as one write of a TransactWriteItems call. */
export interface UpdateOperation {
  TableName: string;
  Key: Record<string, unknown>;
  UpdateExpression: string;
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
}

/** A DocumentClient that drops undefined attributes instead of failing on them. */
export function createDocumentClient(region = process.env.AWS_REGION): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

/** True when a write was refused by its condition expression (an expected outcome, not a fault). */
export function isConditionalCheckFailed(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'ConditionalCheckFailedException';
}

/**
 * For a TransactWriteItems call refused as a whole, the reason code of each write in order ('None' for a write
 * that was fine, 'ConditionalCheckFailed', 'TransactionConflict', ...). Undefined for any other error.
 */
export function cancellationCodes(error: unknown): string[] | undefined {
  const candidate = error as { name?: string; CancellationReasons?: { Code?: string }[] } | null;
  if (candidate?.name !== 'TransactionCanceledException') return undefined;
  return (candidate.CancellationReasons ?? []).map((reason) => reason.Code ?? 'None');
}

/** A write refused because the account was deleted while the request was running (FR8.1, R-08). */
export class AccountDeletedError extends Error {
  constructor() {
    super('The account was deleted.');
    this.name = 'AccountDeletedError';
  }
}

type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

/** One conditional Put or Update that is only written while the account is not deleted. */
export type GuardedWrite = { Put: NonNullable<TransactItem['Put']> } | { Update: NonNullable<TransactItem['Update']> };

/** A transaction that collided with another one on the same item is retried this many times in total. */
const MAX_GUARDED_ATTEMPTS = 4;

/**
 * How long to wait before attempt `attempt + 1` of a transaction that collided with another: doubling from 25 ms,
 * plus up to the same again at random, so requests that collided do not retry in lockstep and collide again.
 */
export function conflictRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = 25 * 2 ** (attempt - 1);
  return base + Math.floor(random() * base);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends `write` in one TransactWriteItems together with a check that the user's DELETED marker does not exist. So
 * once deletion has written the marker, nothing more is written for the account, even by a request that passed
 * the API's earlier marker check (FR8.1, R-08).
 *
 * - The write's own condition failing throws ConditionalCheckFailedException, as the plain write would.
 * - The marker check failing throws AccountDeletedError.
 * - A collision with another transaction (several requests from one user at once all check the same marker) is
 *   retried after a short random pause, up to 4 attempts in all.
 */
export async function writeUnlessDeleted(
  doc: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
  write: GuardedWrite,
): Promise<void> {
  const notDeleted: TransactItem = {
    ConditionCheck: {
      TableName: tableName,
      Key: { pk: userPk(userId), sk: DELETED_SK },
      ConditionExpression: 'attribute_not_exists(pk)',
    },
  };
  for (let attempt = 1; ; attempt += 1) {
    try {
      await doc.send(new TransactWriteCommand({ TransactItems: [notDeleted, write] }));
      return;
    } catch (error) {
      const codes = cancellationCodes(error);
      if (!codes) throw error;
      if (codes[0] === 'ConditionalCheckFailed') throw new AccountDeletedError();
      if (codes[1] === 'ConditionalCheckFailed') {
        throw new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
      }
      if (!codes.includes('TransactionConflict') || attempt >= MAX_GUARDED_ATTEMPTS) throw error;
      await pause(conflictRetryDelayMs(attempt));
    }
  }
}

/** Epoch seconds, the unit DynamoDB TTL attributes use. */
export const epochSeconds = (instant: Date): number => Math.floor(instant.getTime() / 1000);

/** Reads a required environment variable or fails fast with a clear message. */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`Missing required environment variable ${name}`);
  return value;
}
