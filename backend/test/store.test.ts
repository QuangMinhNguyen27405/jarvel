import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IllegalTransitionError, PlanStore, planExpiresAt } from '../src/lib/store.js';
import { createFakeTable, TABLE_NAME, type FakeTable } from './fixtures/fake-dynamo.js';
import { ALICE, BOB, queuedPlan } from './fixtures/plans.js';
import { validTripRequest } from './fixtures/requests.js';

let table: FakeTable;
let now: Date;
let store: PlanStore;

beforeEach(() => {
  table = createFakeTable();
  now = new Date('2026-10-23T16:00:00Z');
  store = new PlanStore(table.doc, TABLE_NAME, () => now);
});
afterEach(() => table.mock.restore());

describe('PlanStore.createPlan / getPlan', () => {
  it('stores a plan under the owner key with a TTL of departure + 90 days', async () => {
    const plan = queuedPlan();
    await store.createPlan(plan);
    const item = table.get(`USER#${ALICE}`, `PLAN#${plan.planId}`);
    // Departure 2026-11-21 15:00 EST + 90 days = 2027-02-19 15:00 EST = 20:00 UTC.
    expect(item?.expiresAt).toBe(Date.parse('2027-02-19T20:00:00Z') / 1000);
    expect(await store.getPlan(ALICE, plan.planId)).toEqual(plan);
  });

  it('refuses to overwrite an existing plan id', async () => {
    const plan = queuedPlan();
    await store.createPlan(plan);
    await expect(store.createPlan(plan)).rejects.toThrow(/conditional request failed/);
  });

  it("answers someone else's plan exactly like a missing one (FR1.5, AC1.3.1)", async () => {
    const plan = queuedPlan();
    await store.createPlan(plan);
    expect(await store.getPlan(BOB, plan.planId)).toBeUndefined();
    expect(await store.getPlan(ALICE, 'no-such-plan')).toBeUndefined();
  });

  it('no longer returns a plan 91 days after departure, but still does at 89 (AC5.4.1, AC5.4.2)', async () => {
    const plan = queuedPlan({
      request: validTripRequest({ arrival: '2026-11-18T10:00', departure: '2026-11-21T15:00' }),
    });
    await store.createPlan(plan);
    now = new Date('2027-02-17T20:00:00Z'); // 88 days + a bit after departure
    expect(await store.getPlan(ALICE, plan.planId)).toBeDefined();
    now = new Date('2027-02-18T20:00:00Z'); // 89 days
    expect(await store.getPlan(ALICE, plan.planId)).toBeDefined();
    now = new Date('2027-02-20T20:00:00Z'); // 91 days
    expect(await store.getPlan(ALICE, plan.planId)).toBeUndefined();
    expect(planExpiresAt('2026-11-21T15:00')).toBe(Date.parse('2027-02-19T20:00:00Z') / 1000);
  });
});

describe('PlanStore.listPlans / renamePlan (FR13)', () => {
  it("lists only the owner's unexpired plans, newest first, with plan id as the tie-break", async () => {
    const older = queuedPlan({ planId: 'p-older', createdAt: '2026-10-20T10:00:00.000Z' });
    const tieB = queuedPlan({ planId: 'p-tie-b', createdAt: '2026-10-22T10:00:00.000Z' });
    const tieA = queuedPlan({ planId: 'p-tie-a', createdAt: '2026-10-22T10:00:00.000Z' });
    const bobs = queuedPlan({ planId: 'p-bob', userId: BOB, createdAt: '2026-10-23T10:00:00.000Z' });
    for (const plan of [older, tieB, tieA, bobs]) await store.createPlan(plan);
    expect((await store.listPlans(ALICE)).map((p) => p.planId)).toEqual(['p-tie-a', 'p-tie-b', 'p-older']);
    expect((await store.listPlans(BOB)).map((p) => p.planId)).toEqual(['p-bob']);
  });

  it('leaves out plans whose retention has passed and answers an empty list for a new user', async () => {
    await store.createPlan(queuedPlan({ planId: 'p-kept' }));
    expect(await store.listPlans('someone-new')).toEqual([]);
    now = new Date('2027-02-20T20:00:00Z'); // 91 days after the fixture's departure
    expect(await store.listPlans(ALICE)).toEqual([]);
  });

  it("renames only the owner's plan and refuses an unknown one", async () => {
    const plan = queuedPlan();
    await store.createPlan(plan);
    now = new Date('2026-10-23T17:00:00Z');
    expect(await store.renamePlan(ALICE, plan.planId, 'New title')).toBe(true);
    expect(await store.getPlan(ALICE, plan.planId)).toMatchObject({
      title: 'New title',
      updatedAt: '2026-10-23T17:00:00.000Z',
    });
    expect(await store.renamePlan(BOB, plan.planId, 'Hijacked')).toBe(false);
    expect(await store.renamePlan(ALICE, 'no-such-plan', 'Nope')).toBe(false);
    expect((await store.getPlan(ALICE, plan.planId))!.title).toBe('New title');
  });

  it('refuses to rename a plan past its retention time that DynamoDB has not removed yet (R-10)', async () => {
    const plan = queuedPlan({ title: 'Old title' });
    await store.createPlan(plan);
    const expiresAt = table.get(`USER#${ALICE}`, `PLAN#${plan.planId}`)!.expiresAt as number;
    now = new Date((expiresAt - 60) * 1000); // a minute before: still renamable
    expect(await store.renamePlan(ALICE, plan.planId, 'Still mine')).toBe(true);
    now = new Date(expiresAt * 1000); // the exact second it expires: gone, as for get and list
    expect(await store.renamePlan(ALICE, plan.planId, 'Too late')).toBe(false);
    expect(table.get(`USER#${ALICE}`, `PLAN#${plan.planId}`)!.title).toBe('Still mine');
  });
});

describe('PlanStore.transitionPlan (FR2.4)', () => {
  it('moves only QUEUED -> RUNNING -> SUCCEEDED and never leaves a final status (AC3.1.2, AC3.1.3)', async () => {
    const plan = queuedPlan();
    await store.createPlan(plan);
    expect(await store.transitionPlan(ALICE, plan.planId, 'SUCCEEDED')).toBe(false); // cannot skip RUNNING
    expect(await store.transitionPlan(ALICE, plan.planId, 'RUNNING')).toBe(true);
    expect(await store.transitionPlan(ALICE, plan.planId, 'RUNNING')).toBe(false);
    expect(await store.transitionPlan(ALICE, plan.planId, 'SUCCEEDED', { aiCostUSD: 0.02, durationMs: 42_000 })).toBe(
      true,
    );
    expect(await store.transitionPlan(ALICE, plan.planId, 'FAILED')).toBe(false);
    const stored = await store.getPlan(ALICE, plan.planId);
    expect(stored).toMatchObject({ status: 'SUCCEEDED', aiCostUSD: 0.02, durationMs: 42_000 });
  });

  it('allows QUEUED -> FAILED (a plan that never started) and keeps FAILED final', async () => {
    const plan = queuedPlan();
    await store.createPlan(plan);
    expect(await store.transitionPlan(ALICE, plan.planId, 'FAILED', { failureKind: 'timeout' })).toBe(true);
    expect(await store.transitionPlan(ALICE, plan.planId, 'RUNNING')).toBe(false);
    expect((await store.getPlan(ALICE, plan.planId))?.status).toBe('FAILED');
  });

  it('refuses any move back to QUEUED and any move of a missing plan', async () => {
    await expect(store.transitionPlan(ALICE, 'x', 'QUEUED')).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(await store.transitionPlan(ALICE, 'missing', 'RUNNING')).toBe(false);
  });

  it('surfaces a storage fault instead of reporting a refused transition', async () => {
    table.failNext('Update', new Error('ProvisionedThroughputExceeded'));
    await expect(store.transitionPlan(ALICE, 'x', 'RUNNING')).rejects.toThrow('ProvisionedThroughputExceeded');
  });
});

describe('PlanStore deletion (FR8, FR8.1)', () => {
  it('deletes the caller’s plan so its record is gone (AC5.3.1, AC5.3.2)', async () => {
    const plan = queuedPlan();
    await store.createPlan(plan);
    expect(await store.deletePlan(ALICE, plan.planId)).toBe(true);
    expect(table.get(`USER#${ALICE}`, `PLAN#${plan.planId}`)).toBeUndefined();
    expect(await store.deletePlan(ALICE, plan.planId)).toBe(false);
  });

  it("does not delete someone else's plan (AC1.3.2)", async () => {
    const plan = queuedPlan();
    await store.createPlan(plan);
    expect(await store.deletePlan(BOB, plan.planId)).toBe(false);
    expect(await store.getPlan(ALICE, plan.planId)).toBeDefined();
  });

  it('deletes all plans and idempotency keys of one user and keeps quota items for the hold step (FR8.1, D6)', async () => {
    await store.createPlan(queuedPlan());
    await store.createPlan(queuedPlan());
    const bobPlan = queuedPlan({ userId: BOB });
    await store.createPlan(bobPlan);
    table.put({ pk: `USER#${ALICE}`, sk: 'IDEM#key-1', planId: 'p' });
    table.put({ pk: `USER#${ALICE}`, sk: 'QUOTA#2026-10', count: 2 });
    expect(await store.deleteAllForUser(ALICE)).toEqual({ plans: 2, idempotencyKeys: 1 });
    expect(table.itemsMentioning(`USER#${ALICE}`).map((item) => item.sk)).toEqual(['QUOTA#2026-10']);
    expect(await store.getPlan(BOB, bobPlan.planId)).toBeDefined();
  });

  it('surfaces a failed batch delete', async () => {
    await store.createPlan(queuedPlan());
    table.failNext('BatchWrite', new Error('InternalServerError'));
    await expect(store.deleteAllForUser(ALICE)).rejects.toThrow('InternalServerError');
  });
});
