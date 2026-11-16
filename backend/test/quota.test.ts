import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletedError, conflictRetryDelayMs, writeUnlessDeleted } from '../src/lib/dynamo.js';
import { hashEmail, QuotaStore } from '../src/lib/quota.js';
import { PlanStore } from '../src/lib/store.js';
import { createFakeTable, TABLE_NAME, type FakeTable } from './fixtures/fake-dynamo.js';
import { ALICE, BOB, queuedPlan } from './fixtures/plans.js';

let table: FakeTable;
let quota: QuotaStore;
const NOV = new Date('2026-11-10T15:00:00Z');

beforeEach(() => {
  table = createFakeTable();
  quota = new QuotaStore(table.doc, TABLE_NAME);
});
afterEach(() => table.mock.restore());

async function reserveTimes(times: number, at: Date) {
  const results = [];
  for (let i = 0; i < times; i += 1) results.push(await quota.reserve(ALICE, at));
  return results;
}

describe('QuotaStore.reserve (FR6, FR6.2)', () => {
  it('accepts 3 plans in a month and refuses the 4th with the limit, used count and reset date (AC2.4.1)', async () => {
    const results = await reserveTimes(4, NOV);
    expect(results.slice(0, 3).map((r) => r.accepted)).toEqual([true, true, true]);
    expect(results[3]).toEqual({ accepted: false, month: '2026-11', used: 3, limit: 3, resetsOn: '2026-12-01' });
  });

  it('resets at 00:00 Boston time on the 1st, not at UTC midnight (AC2.4.2)', async () => {
    await reserveTimes(3, NOV);
    expect((await quota.reserve(ALICE, new Date('2026-12-01T04:59:00Z'))).accepted).toBe(false); // 23:59 EST
    const first = await quota.reserve(ALICE, new Date('2026-12-01T05:00:00Z')); // 00:00 EST
    expect(first).toEqual({ accepted: true, month: '2026-12', used: 1 });
  });

  it('uses Boston local midnight when the month changes in a daylight-saving week (AC2.4.4)', async () => {
    // DST ends 2026-11-01. Oct 31 23:59 EDT is 03:59 UTC; Nov 1 00:00 EDT is 04:00 UTC.
    await reserveTimes(3, new Date('2026-10-31T03:59:00Z'));
    expect((await quota.reserve(ALICE, new Date('2026-11-01T03:59:00Z'))).accepted).toBe(false);
    expect((await quota.reserve(ALICE, new Date('2026-11-01T04:00:00Z'))).accepted).toBe(true);
  });

  it('lets exactly 1 of 5 simultaneous requests through when 2 are used (AC2.4.3)', async () => {
    await reserveTimes(2, NOV);
    const results = await Promise.all(Array.from({ length: 5 }, () => quota.reserve(ALICE, NOV)));
    expect(results.filter((r) => r.accepted)).toHaveLength(1);
    expect(results.filter((r) => !r.accepted)).toHaveLength(4);
    expect(await quota.used(ALICE, '2026-11')).toBe(3);
  });

  it('surfaces a storage fault instead of treating it as a refusal', async () => {
    table.failNext('TransactWrite', new Error('ServiceUnavailable')); // the guarded write is a transaction (R-08)
    await expect(quota.reserve(ALICE, NOV)).rejects.toThrow('ServiceUnavailable');
  });

  it('counts nothing once the account is marked deleted, and says so (R-08)', async () => {
    await quota.reserve(ALICE, NOV);
    await new PlanStore(table.doc, TABLE_NAME, () => NOV).markAccountDeleted(ALICE);
    await expect(quota.reserve(ALICE, NOV)).rejects.toThrow(AccountDeletedError);
    expect(await quota.used(ALICE, '2026-11')).toBe(1);
    expect((await quota.reserve(BOB, NOV)).accepted).toBe(true); // another, live user is unaffected
  });

  it('retries a reservation that collided with another transaction', async () => {
    table.failNext(
      'TransactWrite',
      new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: [{ Code: 'None' }, { Code: 'TransactionConflict' }],
      }),
    );
    expect(await quota.reserve(ALICE, NOV)).toEqual({ accepted: true, month: '2026-11', used: 1 });
  });
});

describe('retrying a write that collided with another transaction', () => {
  const conflict = () =>
    new TransactionCanceledException({
      message: 'Transaction cancelled',
      $metadata: {},
      CancellationReasons: [{ Code: 'None' }, { Code: 'TransactionConflict' }],
    });
  const write = { Put: { TableName: TABLE_NAME, Item: { pk: 'USER#x', sk: 'PLAN#1' } } };

  it('waits a doubling, randomised pause between attempts so colliding requests spread out', () => {
    expect(conflictRetryDelayMs(1, () => 0)).toBe(25);
    expect(conflictRetryDelayMs(1, () => 0.99)).toBe(49);
    expect(conflictRetryDelayMs(2, () => 0)).toBe(50);
    expect(conflictRetryDelayMs(3, () => 0.5)).toBe(150);
  });

  it('gives up after 4 attempts in all and surfaces the collision', async () => {
    const send = vi.fn().mockRejectedValue(conflict());
    const doc = { send } as unknown as Parameters<typeof writeUnlessDeleted>[0];
    await expect(writeUnlessDeleted(doc, TABLE_NAME, 'x', write)).rejects.toThrow('Transaction cancelled');
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('succeeds when a later attempt no longer collides', async () => {
    const send = vi.fn().mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict()).mockResolvedValue({});
    const doc = { send } as unknown as Parameters<typeof writeUnlessDeleted>[0];
    await expect(writeUnlessDeleted(doc, TABLE_NAME, 'x', write)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe('QuotaStore.refund (FR6.1, FR8.3)', () => {
  it('gives a count back after a failure on our side, so 3 more plans are accepted (AC2.5.1, AC2.5.2, AC2.5.4)', async () => {
    await quota.reserve(ALICE, NOV); // this plan fails on our side
    expect(await quota.refund(ALICE, '2026-11')).toBe(true);
    const results = await reserveTimes(3, NOV);
    expect(results.every((r) => r.accepted)).toBe(true);
    expect((await quota.reserve(ALICE, NOV)).accepted).toBe(false);
  });

  it('does not go below zero', async () => {
    expect(await quota.refund(ALICE, '2026-11')).toBe(false);
    expect(await quota.used(ALICE, '2026-11')).toBe(0);
  });

  it('is not given back when a counted plan is deleted (AC2.5.3)', async () => {
    const store = new PlanStore(table.doc, TABLE_NAME, () => NOV);
    await quota.reserve(ALICE, NOV);
    const plan = queuedPlan();
    await store.createPlan(plan);
    await store.deletePlan(ALICE, plan.planId);
    expect(await quota.used(ALICE, '2026-11')).toBe(1);
  });
});

describe('QuotaStore.refundWithTransition: status change and refund together (FR6.1, AC2.5.1, AC2.5.2)', () => {
  let store: PlanStore;
  let plan: ReturnType<typeof queuedPlan>;
  const status = async () => (await store.getPlan(ALICE, plan.planId))?.status;
  const toFailed = () => store.transitionOperation(ALICE, plan.planId, 'FAILED', { failureKind: 'internal' });
  const conflict = () =>
    new TransactionCanceledException({
      message: 'Transaction cancelled [TransactionConflict, None]',
      $metadata: {},
      CancellationReasons: [{ Code: 'TransactionConflict' }, { Code: 'None' }],
    });

  beforeEach(async () => {
    store = new PlanStore(table.doc, TABLE_NAME, () => NOV);
    plan = queuedPlan();
    await store.createPlan(plan);
    await reserveTimes(2, NOV);
  });

  it('applies both: the plan is FAILED and exactly one count is given back', async () => {
    expect(await quota.refundWithTransition(toFailed(), ALICE, '2026-11')).toBe('refunded');
    expect(await status()).toBe('FAILED');
    expect(await quota.used(ALICE, '2026-11')).toBe(1);
  });

  it('applies neither when the status change is refused, so a plan is never refunded twice', async () => {
    await quota.refundWithTransition(toFailed(), ALICE, '2026-11');
    expect(await quota.refundWithTransition(toFailed(), ALICE, '2026-11')).toBe('not-moved');
    expect(await quota.used(ALICE, '2026-11')).toBe(1);
  });

  it('applies neither when the month has no count to give back', async () => {
    expect(await quota.refundWithTransition(toFailed(), ALICE, '2026-09')).toBe('nothing-to-refund');
    expect(await status()).toBe('QUEUED');
    expect(await quota.used(ALICE, '2026-09')).toBe(0);
  });

  it('leaves the status and the count unchanged when the transaction fails', async () => {
    table.failNext('TransactWrite', new Error('ServiceUnavailable'));
    await expect(quota.refundWithTransition(toFailed(), ALICE, '2026-11')).rejects.toThrow('ServiceUnavailable');
    expect(await status()).toBe('QUEUED');
    expect(await quota.used(ALICE, '2026-11')).toBe(2);
  });

  it('retries a transaction that collided with another one, and gives up after three attempts', async () => {
    table.failNext('TransactWrite', conflict());
    expect(await quota.refundWithTransition(toFailed(), ALICE, '2026-11')).toBe('refunded');
    expect(await quota.used(ALICE, '2026-11')).toBe(1);

    const other = queuedPlan();
    await store.createPlan(other);
    table.mock.on(TransactWriteCommand).rejects(conflict());
    const callsBefore = table.mock.commandCalls(TransactWriteCommand).length;
    const operation = store.transitionOperation(ALICE, other.planId, 'FAILED');
    await expect(quota.refundWithTransition(operation, ALICE, '2026-11')).rejects.toThrow('TransactionConflict');
    expect(table.mock.commandCalls(TransactWriteCommand).length - callsBefore).toBe(3);
    expect((await store.getPlan(ALICE, other.planId))?.status).toBe('QUEUED');
    expect(await quota.used(ALICE, '2026-11')).toBe(1);
  });

  it('gives one refund when two callers race to fail the same plan', async () => {
    const outcomes = await Promise.all([
      quota.refundWithTransition(toFailed(), ALICE, '2026-11'),
      quota.refundWithTransition(toFailed(), ALICE, '2026-11'),
    ]);
    expect(outcomes.sort()).toEqual(['not-moved', 'refunded']);
    expect(await quota.used(ALICE, '2026-11')).toBe(1);
  });
});

describe('account deletion keeps the month’s count without keeping the user id (AC6.3.1, AC6.3.2, D6)', () => {
  it('moves the count to an email-hash hold, leaves nothing keyed by the user id, and restores it on re-invite', async () => {
    const store = new PlanStore(table.doc, TABLE_NAME, () => NOV);
    await store.createPlan(queuedPlan());
    await reserveTimes(2, NOV);
    table.put({ pk: `USER#${ALICE}`, sk: 'QUOTA#2026-09', count: 3 }); // an old month is simply dropped
    const emailHash = hashEmail(' Alice@Example.com ');
    await store.deleteAllForUser(ALICE);
    expect(await quota.holdForDeletedAccount(ALICE, emailHash, NOV)).toBe(2);
    expect(table.itemsMentioning(ALICE)).toEqual([]);
    expect(table.itemsMentioning('alice@example.com')).toEqual([]);

    const newSub = 'sub-alice-reinvited';
    expect(await quota.restoreHeld(newSub, hashEmail('alice@example.com'), NOV)).toBe(2);
    expect(await quota.used(newSub, '2026-11')).toBe(2);
    expect(await quota.restoreHeld(newSub, emailHash, NOV)).toBe(0); // the hold is used once
  });

  it('reads every page of the user’s quota items when moving them to the hold', async () => {
    await reserveTimes(2, NOV);
    table.put({ pk: `USER#${ALICE}`, sk: 'QUOTA#2026-12', count: 1 });
    table.put({ pk: `USER#${ALICE}`, sk: 'QUOTA#2026-10', count: 3 });
    table.setQueryPageSize(1);
    const emailHash = hashEmail('alice@example.com');
    expect(await quota.holdForDeletedAccount(ALICE, emailHash, NOV)).toBe(2);
    expect(table.itemsMentioning(ALICE)).toEqual([]);
    expect(table.get(`HOLD#${emailHash}`, 'QUOTA#2026-12')?.count).toBe(1);
    expect(table.get(`HOLD#${emailHash}`, 'QUOTA#2026-10')).toBeUndefined(); // a past month is dropped
  });

  it('removes leftover quota items by user id alone on a re-run, across pages', async () => {
    await reserveTimes(1, NOV);
    table.put({ pk: `USER#${ALICE}`, sk: 'QUOTA#2026-12', count: 1 });
    table.put({ pk: `USER#${BOB}`, sk: 'QUOTA#2026-11', count: 1 });
    table.setQueryPageSize(1);
    expect(await quota.removeForDeletedAccount(ALICE)).toBe(2);
    expect(table.itemsMentioning(ALICE)).toEqual([]);
    expect(await quota.used(BOB, '2026-11')).toBe(1);
    expect(await quota.removeForDeletedAccount(ALICE)).toBe(0);
  });

  it('surfaces a storage fault while reading the quota items', async () => {
    table.failNext('Query', new Error('InternalServerError'));
    await expect(quota.holdForDeletedAccount(ALICE, hashEmail('a@b.c'), NOV)).rejects.toThrow('InternalServerError');
  });
});
