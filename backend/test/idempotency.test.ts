import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLAIM_SETTLE_SECONDS,
  IDEMPOTENCY_KEY_PATTERN,
  IdempotencyStore,
  requestHash,
} from '../src/lib/idempotency.js';
import { createFakeTable, TABLE_NAME, type FakeTable } from './fixtures/fake-dynamo.js';
import { ALICE, BOB } from './fixtures/plans.js';
import { validRequestBody } from './fixtures/requests.js';

let table: FakeTable;
let store: IdempotencyStore;
const NOW = new Date('2026-10-23T16:00:00Z');

beforeEach(() => {
  table = createFakeTable();
  store = new IdempotencyStore(table.doc, TABLE_NAME);
});
afterEach(() => table.mock.restore());

describe('requestHash', () => {
  it('ignores key order but not content', () => {
    expect(requestHash({ a: 1, b: { c: [1, 2] } })).toBe(requestHash({ b: { c: [1, 2] }, a: 1 }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
    expect(requestHash([1, 2])).not.toBe(requestHash([2, 1]));
  });
});

describe('IdempotencyStore.claim (FR2.6, D7)', () => {
  const hash = requestHash(validRequestBody());

  it('returns the first plan when the same key and body come again (AC2.3.1)', async () => {
    expect(await store.claim(ALICE, 'retry-1', hash, 'plan-1', NOW)).toEqual({ outcome: 'new' });
    expect(await store.claim(ALICE, 'retry-1', hash, 'plan-2', NOW)).toEqual({
      outcome: 'replay',
      planId: 'plan-1',
      settled: false,
    });
  });

  it('reports a replay as settled once the first request has had time to finish', async () => {
    await store.claim(ALICE, 'retry-1', hash, 'plan-1', NOW);
    const justBefore = new Date(NOW.getTime() + (CLAIM_SETTLE_SECONDS - 1) * 1000);
    const after = new Date(NOW.getTime() + CLAIM_SETTLE_SECONDS * 1000);
    expect(await store.claim(ALICE, 'retry-1', hash, 'plan-2', justBefore)).toMatchObject({ settled: false });
    expect(await store.claim(ALICE, 'retry-1', hash, 'plan-2', after)).toMatchObject({ settled: true });
  });

  it('dates a claim written before claimedAt existed from its expiry', async () => {
    const expiresAt = NOW.getTime() / 1000 + 24 * 3600;
    table.put({ pk: `USER#${ALICE}`, sk: 'IDEM#old', bodyHash: hash, planId: 'plan-old', expiresAt });
    const later = new Date(NOW.getTime() + 60_000);
    expect(await store.claim(ALICE, 'old', hash, 'plan-2', later)).toEqual({
      outcome: 'replay',
      planId: 'plan-old',
      settled: true,
    });
  });

  it('reports a conflict when the key is reused with a different body (AC2.3.2)', async () => {
    await store.claim(ALICE, 'retry-1', hash, 'plan-1', NOW);
    const other = requestHash(validRequestBody({ travelers: 3 }));
    expect(await store.claim(ALICE, 'retry-1', other, 'plan-2', NOW)).toEqual({ outcome: 'conflict' });
  });

  it('keeps keys separate per user and per key', async () => {
    await store.claim(ALICE, 'retry-1', hash, 'plan-1', NOW);
    expect(await store.claim(BOB, 'retry-1', hash, 'plan-9', NOW)).toEqual({ outcome: 'new' });
    expect(await store.claim(ALICE, 'retry-2', hash, 'plan-3', NOW)).toEqual({ outcome: 'new' });
  });

  it('expires a key after 24 hours and then treats it as new', async () => {
    await store.claim(ALICE, 'retry-1', hash, 'plan-1', NOW);
    expect(table.get(`USER#${ALICE}`, 'IDEM#retry-1')?.expiresAt).toBe(NOW.getTime() / 1000 + 24 * 3600);
    const later = new Date(NOW.getTime() + 24 * 3600 * 1000);
    expect(await store.claim(ALICE, 'retry-1', hash, 'plan-2', later)).toEqual({ outcome: 'new' });
  });

  it('can release a claim so the key is free again', async () => {
    await store.claim(ALICE, 'retry-1', hash, 'plan-1', NOW);
    await store.release(ALICE, 'retry-1');
    expect(await store.claim(ALICE, 'retry-1', hash, 'plan-2', NOW)).toEqual({ outcome: 'new' });
  });

  it('reports a conflict if the claim vanished between the refused write and the read', async () => {
    await store.claim(ALICE, 'retry-1', hash, 'plan-1', NOW);
    table.mock.on(GetCommand).resolvesOnce({ Item: undefined });
    expect(await store.claim(ALICE, 'retry-1', hash, 'plan-2', NOW)).toEqual({ outcome: 'conflict' });
  });

  it('surfaces a storage fault on the follow-up read', async () => {
    await store.claim(ALICE, 'retry-1', hash, 'plan-1', NOW);
    table.failNext('Get', new Error('InternalServerError'));
    await expect(store.claim(ALICE, 'retry-1', hash, 'plan-2', NOW)).rejects.toThrow('InternalServerError');
  });

  it('lets one request take over a key whose plan is missing, and only one when two race', async () => {
    await store.claim(ALICE, 'retry-1', hash, 'plan-lost', NOW);
    const claim = (planId: string) => ({ bodyHash: hash, stalePlanId: 'plan-lost', planId });
    const results = await Promise.all([
      store.takeOver(ALICE, 'retry-1', claim('plan-a'), NOW),
      store.takeOver(ALICE, 'retry-1', claim('plan-b'), NOW),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results[0] ? 'plan-a' : 'plan-b';
    expect(table.get(`USER#${ALICE}`, 'IDEM#retry-1')).toMatchObject({ planId: winner, bodyHash: hash });
  });

  it('does not take over a key that was released or never claimed', async () => {
    const claim = { bodyHash: hash, stalePlanId: 'plan-lost', planId: 'plan-a' };
    expect(await store.takeOver(ALICE, 'never', claim, NOW)).toBe(false);
    expect(table.get(`USER#${ALICE}`, 'IDEM#never')).toBeUndefined();
  });

  it('surfaces a storage fault while taking over a key', async () => {
    table.failNext('TransactWrite', new Error('InternalServerError')); // the guarded write is a transaction (R-08)
    const claim = { bodyHash: hash, stalePlanId: 'plan-lost', planId: 'plan-a' };
    await expect(store.takeOver(ALICE, 'retry-1', claim, NOW)).rejects.toThrow('InternalServerError');
  });

  it('accepts only short, plain key strings', () => {
    expect(IDEMPOTENCY_KEY_PATTERN.test('3f0c-retry_1:a.b')).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test('')).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test('has space')).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test('x'.repeat(129))).toBe(false);
  });
});
