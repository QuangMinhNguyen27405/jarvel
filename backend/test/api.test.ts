import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { PlanRecord } from '@jarvel/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiHandler, lambdaPlannerInvoker, type ApiDeps, type ApiEvent } from '../src/handlers/api.js';
import { createPlannerHandler } from '../src/handlers/planner.js';
import { DEFAULT_PRICES } from '../src/lib/ai.js';
import { loadBostonData } from '../src/lib/data.js';
import { CLAIM_SETTLE_SECONDS, IdempotencyStore, requestHash } from '../src/lib/idempotency.js';
import { createLogger, createMetrics } from '../src/lib/log.js';
import { FAILURE_REASONS } from '../src/lib/planner.js';
import { QuotaStore } from '../src/lib/quota.js';
import { DEFAULT_PREFERENCES } from '../src/lib/schemas.js';
import { PlanStore } from '../src/lib/store.js';
import { createFakeTable, TABLE_NAME, type FakeTable } from './fixtures/fake-dynamo.js';
import { baseSelection, fakeConverse, toolAnswer } from './fixtures/fake-ai.js';
import { ALICE, BOB } from './fixtures/plans.js';
import { TEST_NOW, validRequestBody } from './fixtures/requests.js';

const data = loadBostonData();
const lambdaMock = mockClient(LambdaClient);
let table: FakeTable;
let clock: Date;
let logs: string[];
let ids: number;
let deps: ApiDeps;
let api: (event: ApiEvent) => ReturnType<ReturnType<typeof createApiHandler>>;

beforeEach(() => {
  table = createFakeTable();
  lambdaMock.reset();
  lambdaMock.on(InvokeCommand).resolves({ StatusCode: 202 });
  clock = TEST_NOW;
  logs = [];
  ids = 0;
  deps = {
    store: new PlanStore(table.doc, TABLE_NAME, () => clock),
    quota: new QuotaStore(table.doc, TABLE_NAME),
    idempotency: new IdempotencyStore(table.doc, TABLE_NAME),
    data,
    invokePlanner: lambdaPlannerInvoker(new LambdaClient({ region: 'us-east-1' }), 'planner-fn'),
    newPlanId: () => `00000000-0000-4000-a000-${String(++ids).padStart(12, '0')}`,
    now: () => clock,
    log: createLogger({}, (line) => logs.push(line)),
    metrics: createMetrics('test', (line) => logs.push(line)),
  };
  api = createApiHandler(deps);
});
afterEach(() => table.mock.restore());

interface EventOptions {
  sub?: string | null;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  planId?: string;
  query?: Record<string, string>;
}

function event(routeKey: string, options: EventOptions = {}): ApiEvent {
  const sub = options.sub === undefined ? ALICE : options.sub;
  return {
    routeKey,
    headers: options.headers ?? {},
    body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    isBase64Encoded: false,
    pathParameters: options.planId ? { planId: options.planId } : undefined,
    queryStringParameters: options.query,
    requestContext: { authorizer: sub === null ? undefined : { jwt: { claims: { sub }, scopes: [] } } },
  } as unknown as ApiEvent;
}

const bodyOf = (response: { body?: string }) => JSON.parse(response.body ?? 'null');
const used = (userId = ALICE) => deps.quota.used(userId, '2026-10');

async function submit(body: unknown = validRequestBody(), options: EventOptions = {}) {
  return api(event('POST /plans', { body, ...options }));
}

describe('sign-in is required (US1.2)', () => {
  it('answers the health check without a token and returns no data (AC1.2.4)', async () => {
    const response = await api(event('GET /health', { sub: null }));
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toEqual({ status: 'ok' });
  });

  it('refuses every other route without a valid identity with 401 and no data (AC1.2.1, AC1.2.2)', async () => {
    for (const routeKey of [
      'POST /plans',
      'GET /plans',
      'PATCH /plans/{planId}',
      'GET /plans/{planId}',
      'DELETE /plans/{planId}',
    ]) {
      const response = await api(event(routeKey, { sub: null, body: validRequestBody(), planId: deps.newPlanId() }));
      expect(response.statusCode).toBe(401);
      expect(Object.keys(bodyOf(response)).sort()).toEqual(['code', 'error']);
    }
    expect(table.items.size).toBe(0);
  });
});

describe('POST /plans (US2.1, US2.2)', () => {
  it('accepts a valid request at once with QUEUED, stores it as sent and starts the planner (AC2.1.1, AC2.1.2)', async () => {
    const body = validRequestBody();
    const response = await submit(body);
    expect(response.statusCode).toBe(202);
    const created = bodyOf(response);
    expect(created).toEqual({ planId: expect.any(String), version: 1, status: 'QUEUED' });
    const stored = (await deps.store.getPlan(ALICE, created.planId))!;
    expect(stored.request).toMatchObject(body);
    expect(stored).toMatchObject({
      status: 'QUEUED',
      dataVersion: data.dataVersion,
      aiCostUSD: 0,
      acceptedAt: TEST_NOW.toISOString(),
    });
    const invoke = lambdaMock.commandCalls(InvokeCommand)[0]!.args[0].input;
    expect(invoke).toMatchObject({ FunctionName: 'planner-fn', InvocationType: 'Event' });
    expect(JSON.parse(new TextDecoder().decode(invoke.Payload as Uint8Array))).toEqual({
      userId: ALICE,
      planId: created.planId,
    });
    expect(await used()).toBe(1);
  });

  it('fills documented defaults when title, notes and preferences are left out (AC2.1.3)', async () => {
    const body = validRequestBody();
    delete body.title;
    delete body.notes;
    delete body.preferences;
    const created = bodyOf(await submit(body));
    const stored = (await deps.store.getPlan(ALICE, created.planId))!;
    expect(stored.request.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(stored.title).toBe('Boston trip 2026-11-18 to 2026-11-21');
  });

  it('answers 400 naming every bad field and does not count the request (AC2.2.3, AC2.2.5)', async () => {
    const response = await submit(validRequestBody({ travelers: 9, wishlist: 'not a list' }));
    expect(response.statusCode).toBe(400);
    const body = bodyOf(response);
    expect(body.code).toBe('invalid-request');
    expect(body.fields.map((f: { field: string }) => f.field).sort()).toEqual(['travelers', 'wishlist']);
    expect(await used()).toBe(0);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('refuses a body that is not JSON, is too large, or carries a malformed Idempotency-Key', async () => {
    expect((await api(event('POST /plans', { rawBody: '{oops' }))).statusCode).toBe(400);
    expect(
      (await api(event('POST /plans', { rawBody: JSON.stringify({ notes: 'x'.repeat(70_000) }) }))).statusCode,
    ).toBe(413);
    const badKey = await submit(validRequestBody(), { headers: { 'Idempotency-Key': 'has spaces' } });
    expect(bodyOf(badKey).fields[0].field).toBe('Idempotency-Key');
    expect(await used()).toBe(0);
  });

  it('refuses the 4th plan of the month with 429, the limit, the count used and the reset date (AC2.4.1)', async () => {
    for (let i = 0; i < 3; i += 1) expect((await submit()).statusCode).toBe(202);
    const refused = await submit();
    expect(refused.statusCode).toBe(429);
    expect(bodyOf(refused)).toMatchObject({ code: 'quota-exceeded', limit: 3, used: 3, resetsOn: '2026-11-01' });
  });
});

describe('Idempotency-Key (US2.3)', () => {
  const key = { headers: { 'Idempotency-Key': 'trip-retry-1' } };

  it('returns the same plan for the same key and body, counted once (AC2.3.1)', async () => {
    const first = bodyOf(await submit(validRequestBody(), key));
    const again = await submit(validRequestBody(), key);
    expect(again.statusCode).toBe(202);
    expect(again.headers?.['idempotent-replayed']).toBe('true');
    expect(bodyOf(again).planId).toBe(first.planId);
    expect(await used()).toBe(1);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(1);
  });

  it('answers 409 and creates nothing when the key is reused with a different body (AC2.3.2)', async () => {
    await submit(validRequestBody(), key);
    const conflict = await submit(validRequestBody({ travelers: 4 }), key);
    expect(conflict.statusCode).toBe(409);
    expect(bodyOf(conflict).code).toBe('idempotency-conflict');
    expect(table.itemsMentioning('PLAN#')).toHaveLength(1);
  });

  it('treats each submit without a key as a new request (AC2.3.3)', async () => {
    const a = bodyOf(await submit());
    const b = bodyOf(await submit());
    expect(a.planId).not.toBe(b.planId);
    expect(await used()).toBe(2);
  });

  it('frees the key when the monthly limit refuses the request', async () => {
    for (let i = 0; i < 3; i += 1) await submit();
    expect((await submit(validRequestBody(), key)).statusCode).toBe(429);
    expect(table.get(`USER#${ALICE}`, 'IDEM#trip-retry-1')).toBeUndefined();
  });

  it('answers 409 request-in-progress while the first request with the key may still be running', async () => {
    await deps.idempotency.claim(ALICE, 'trip-retry-1', requestHash(validRequestBody()), 'plan-not-yet-stored', clock);
    clock = new Date(TEST_NOW.getTime() + 5_000);
    const response = await submit(validRequestBody(), key);
    expect(response.statusCode).toBe(409);
    expect(bodyOf(response).code).toBe('request-in-progress');
    expect(await used()).toBe(0);
    expect(table.itemsMentioning('PLAN#')).toEqual([]);
  });

  it('releases a key whose plan was never stored once the first request has settled, and treats the retry as new', async () => {
    await deps.idempotency.claim(ALICE, 'trip-retry-1', requestHash(validRequestBody()), 'plan-never-stored', clock);
    clock = new Date(TEST_NOW.getTime() + (CLAIM_SETTLE_SECONDS + 1) * 1000);
    const response = await submit(validRequestBody(), key);
    expect(response.statusCode).toBe(202);
    expect(response.headers?.['idempotent-replayed']).toBeUndefined();
    const { planId } = bodyOf(response);
    expect(table.get(`USER#${ALICE}`, 'IDEM#trip-retry-1')?.planId).toBe(planId);
    expect(await used()).toBe(1);
    expect((await submit(validRequestBody(), key)).headers?.['idempotent-replayed']).toBe('true'); // now guards it
  });

  it('treats a retry as new after the key’s plan was deleted', async () => {
    const first = bodyOf(await submit(validRequestBody(), key)).planId;
    expect((await api(event('DELETE /plans/{planId}', { planId: first }))).statusCode).toBe(204);
    clock = new Date(TEST_NOW.getTime() + (CLAIM_SETTLE_SECONDS + 1) * 1000);
    const again = await submit(validRequestBody(), key);
    expect(again.statusCode).toBe(202);
    expect(bodyOf(again).planId).not.toBe(first);
    expect(await used()).toBe(2); // deleting never gives the count back (FR8.3)
  });

  it('gives the count back and releases the key when the plan cannot be stored, so a retry is new', async () => {
    const failure = vi.spyOn(deps.store, 'createPlan').mockRejectedValueOnce(new Error('InternalServerError'));
    const response = await submit(validRequestBody(), key);
    expect(response.statusCode).toBe(500);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(await used()).toBe(0);
    expect(table.get(`USER#${ALICE}`, 'IDEM#trip-retry-1')).toBeUndefined();
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
    const retry = await submit(validRequestBody(), key);
    expect(retry.statusCode).toBe(202);
    expect(retry.headers?.['idempotent-replayed']).toBeUndefined();
    expect(await used()).toBe(1);
  });
});

describe('deleted accounts (FR8.1, AC6.3.1)', () => {
  it('refuses every plan route for a deleted user id with 401 and writes nothing', async () => {
    const planId = bodyOf(await submit()).planId;
    clock = new Date(TEST_NOW.getTime() + 10 * 60 * 1000); // a read would otherwise fail the stuck plan and refund
    await deps.store.markAccountDeleted(ALICE);
    const before = JSON.stringify([...table.items.entries()]);
    const responses = [
      await submit(validRequestBody(), { headers: { 'Idempotency-Key': 'after-delete' } }),
      await api(event('GET /plans/{planId}', { planId })),
      await api(event('DELETE /plans/{planId}', { planId })),
    ];
    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401]);
    expect(JSON.stringify([...table.items.entries()])).toBe(before);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(1); // only the plan made before the deletion
    expect(logs.join('\n')).toContain('request from a deleted account refused');
  });

  it('leaves a live user unaffected', async () => {
    await deps.store.markAccountDeleted(ALICE);
    const created = await submit(validRequestBody(), { sub: BOB });
    expect(created.statusCode).toBe(202);
    const planId = bodyOf(created).planId;
    expect((await api(event('GET /plans/{planId}', { sub: BOB, planId }))).statusCode).toBe(200);
    expect(await used(BOB)).toBe(1);
  });

  it('answers 500 and writes nothing when the marker cannot be read', async () => {
    table.failNext('Get', new Error('InternalServerError'));
    expect((await submit()).statusCode).toBe(500);
    expect(table.items.size).toBe(0);
  });
});

describe('an account deleted while its request runs (R-08)', () => {
  /** Writes the deleted marker just before `step` runs, after the API's own marker check has passed. */
  function deleteAccountJustBefore(step: 'claim' | 'reserve' | 'createPlan') {
    const mark = () => deps.store.markAccountDeleted(ALICE);
    if (step === 'claim') {
      const original = deps.idempotency.claim.bind(deps.idempotency);
      vi.spyOn(deps.idempotency, 'claim').mockImplementationOnce(async (...args) => (await mark(), original(...args)));
    } else if (step === 'reserve') {
      const original = deps.quota.reserve.bind(deps.quota);
      vi.spyOn(deps.quota, 'reserve').mockImplementationOnce(async (...args) => (await mark(), original(...args)));
    } else {
      const original = deps.store.createPlan.bind(deps.store);
      vi.spyOn(deps.store, 'createPlan').mockImplementationOnce(async (...args) => (await mark(), original(...args)));
    }
  }

  it.each(['claim', 'reserve', 'createPlan'] as const)(
    'refuses with 401 and leaves no plan, retry key or count behind when the marker lands before %s',
    async (step) => {
      deleteAccountJustBefore(step);
      const response = await submit(validRequestBody(), { headers: { 'Idempotency-Key': 'in-flight' } });
      expect(response.statusCode).toBe(401);
      expect(table.itemsMentioning('PLAN#')).toEqual([]);
      expect(table.itemsMentioning('IDEM#')).toEqual([]);
      expect(await used()).toBe(0);
      expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
      expect(logs.join('\n')).toContain('request from an account deleted while it ran refused');
    },
  );

  it('leaves a live user unaffected while another account is being deleted', async () => {
    deleteAccountJustBefore('createPlan'); // marks ALICE, but BOB is the one asking
    const created = await submit(validRequestBody(), { sub: BOB });
    expect(created.statusCode).toBe(202);
    expect(await used(BOB)).toBe(1);
  });
});

describe('GET /plans/{planId} (US1.3, US5.1, US5.2)', () => {
  async function createdPlanId(): Promise<string> {
    return bodyOf(await submit()).planId;
  }

  it('returns the owner’s plan as JSON (AC1.3.3, AC3.1.1)', async () => {
    const planId = await createdPlanId();
    const response = await api(event('GET /plans/{planId}', { planId }));
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toMatchObject({ planId, status: 'QUEUED', progress: [] });
  });

  it("answers 404 for someone else's plan, exactly as for an unknown id (AC1.3.1)", async () => {
    const planId = await createdPlanId();
    const theirs = await api(event('GET /plans/{planId}', { sub: BOB, planId }));
    const unknown = await api(event('GET /plans/{planId}', { sub: BOB, planId: deps.newPlanId() }));
    const malformed = await api(event('GET /plans/{planId}', { planId: '../etc/passwd' }));
    expect(theirs.statusCode).toBe(404);
    expect(theirs.body).toBe(unknown.body);
    expect(malformed.statusCode).toBe(404);
  });

  it('returns Markdown for ?format=markdown and for Accept: text/markdown (AC5.2.1, AC5.2.3)', async () => {
    const planId = await createdPlanId();
    const byQuery = await api(event('GET /plans/{planId}', { planId, query: { format: 'markdown' } }));
    const byAccept = await api(event('GET /plans/{planId}', { planId, headers: { Accept: 'text/markdown' } }));
    for (const response of [byQuery, byAccept]) {
      expect(response.headers?.['content-type']).toContain('text/markdown');
      expect(response.body).toContain('**Status:** QUEUED');
    }
  });

  it('shows a plan stuck for over 5 minutes as FAILED with a plain reason and gives the count back (AC3.2.1, AC5.1.2, AC2.5.1)', async () => {
    const planId = await createdPlanId();
    clock = new Date(TEST_NOW.getTime() + 5 * 60 * 1000 + 1000);
    const response = await api(event('GET /plans/{planId}', { planId }));
    expect(bodyOf(response)).toMatchObject({
      status: 'FAILED',
      failureKind: 'timeout',
      error: FAILURE_REASONS.timeout,
    });
    expect(await used()).toBe(0);
    await api(event('GET /plans/{planId}', { planId })); // a second read refunds nothing more
    expect(await used()).toBe(0);
  });
});

describe('DELETE /plans/{planId} (US5.3)', () => {
  it('deletes the owner’s plan; afterwards it is 404 and its record is gone, and the count stays (AC5.3.1, AC5.3.2, AC2.5.3)', async () => {
    const planId = bodyOf(await submit()).planId;
    expect((await api(event('DELETE /plans/{planId}', { planId }))).statusCode).toBe(204);
    expect((await api(event('GET /plans/{planId}', { planId }))).statusCode).toBe(404);
    expect(table.itemsMentioning(`PLAN#${planId}`)).toEqual([]);
    expect(await used()).toBe(1);
  });

  it("answers 404 for an unknown plan or someone else's, and leaves theirs alone (AC5.3.3, AC1.3.2)", async () => {
    const planId = bodyOf(await submit()).planId;
    expect((await api(event('DELETE /plans/{planId}', { sub: BOB, planId }))).statusCode).toBe(404);
    expect((await api(event('DELETE /plans/{planId}', { planId: deps.newPlanId() }))).statusCode).toBe(404);
    expect(await deps.store.getPlan(ALICE, planId)).toBeDefined();
  });
});

describe('faults and boundaries', () => {
  it('fails the plan and gives the count back when the planner cannot be started', async () => {
    lambdaMock.on(InvokeCommand).rejects(new Error('TooManyRequestsException'));
    const response = await submit();
    expect(response.statusCode).toBe(503);
    const [item] = table.itemsMentioning('PLAN#') as unknown as PlanRecord[];
    expect(item).toMatchObject({ status: 'FAILED', failureKind: 'internal' });
    expect(await used()).toBe(0);
  });

  it('answers 500 with no internal details when storage fails, and logs no email (NFR6)', async () => {
    table.failNext('Get', new Error('connect ECONNREFUSED for admin@example.com'));
    const response = await api(event('GET /plans/{planId}', { planId: deps.newPlanId() }));
    expect(response.statusCode).toBe(500);
    expect(bodyOf(response)).toEqual({
      code: 'internal-error',
      error: 'Something went wrong on our side. Please try again.',
    });
    expect(logs.join('\n')).toContain('request failed');
    expect(logs.join('\n')).not.toContain('admin@example.com');
  });

  it('answers 404 for unknown routes and never changes the Boston data (AC6.4.4)', async () => {
    const before = JSON.stringify(data.places);
    expect((await api(event('PUT /catalog'))).statusCode).toBe(404);
    await submit();
    expect(JSON.stringify(data.places)).toBe(before);
  });
});

describe('PlannerFn handler', () => {
  it('builds a plan from a valid event', async () => {
    const planId = bodyOf(await submit()).planId;
    const planner = createPlannerHandler({
      store: deps.store,
      quota: deps.quota,
      data,
      converse: fakeConverse([toolAnswer(baseSelection())]).converse,
      modelId: 'test-model',
      prices: DEFAULT_PRICES,
      now: () => clock,
      log: deps.log,
      metrics: deps.metrics,
    });
    expect(await planner({ userId: ALICE, planId })).toBe('SUCCEEDED');
    const markdown = await api(event('GET /plans/{planId}', { planId, query: { format: 'markdown' } }));
    expect(markdown.body).toContain('## Day 1: 2026-11-18');
  });

  it('refuses an invalid event', async () => {
    const planner = createPlannerHandler({
      ...deps,
      converse: fakeConverse([]).converse,
      modelId: 'm',
      prices: DEFAULT_PRICES,
    });
    await expect(planner({ userId: ALICE })).rejects.toThrow('Invalid planner event');
    await expect(planner({ userId: ALICE, planId: 'x', extra: 1 })).rejects.toThrow('Invalid planner event');
  });
});

describe('GET /plans (list)', () => {
  it("lists only the caller's plans, newest first, as summaries", async () => {
    const first = bodyOf(await submit(validRequestBody({ title: 'First trip' })));
    clock = new Date(TEST_NOW.getTime() + 60_000);
    const second = bodyOf(await submit(validRequestBody({ title: 'Second trip' }), { headers: {} }));
    await submit(validRequestBody({ title: 'Bob trip' }), { sub: BOB });
    const response = await api(event('GET /plans'));
    expect(response.statusCode).toBe(200);
    const { plans } = bodyOf(response);
    expect(plans.map((p: { planId: string }) => p.planId)).toEqual([second.planId, first.planId]);
    expect(plans[0]).toEqual({
      planId: second.planId,
      title: 'Second trip',
      status: 'QUEUED',
      version: 1,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      arrival: '2026-11-18T10:00',
      departure: '2026-11-21T15:00',
    });
  });

  it('answers an empty list for a new user and fails plans stuck for over 5 minutes', async () => {
    expect(bodyOf(await api(event('GET /plans', { sub: BOB })))).toEqual({ plans: [] });
    await submit();
    clock = new Date(TEST_NOW.getTime() + 6 * 60_000);
    const { plans } = bodyOf(await api(event('GET /plans')));
    expect(plans[0].status).toBe('FAILED');
  });
});

describe('PATCH /plans/{planId} (rename)', () => {
  it('renames the plan and answers the updated plan', async () => {
    const created = bodyOf(await submit());
    const response = await api(
      event('PATCH /plans/{planId}', { planId: created.planId, body: { title: '  New name ' } }),
    );
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toMatchObject({ planId: created.planId, title: 'New name' });
    expect((await deps.store.getPlan(ALICE, created.planId))!.title).toBe('New name');
  });

  it('refuses bad bodies with 400 and field names', async () => {
    const created = bodyOf(await submit());
    for (const body of [{ title: '   ' }, { title: 'x'.repeat(121) }, { title: 'ok', notes: 'no' }, {}]) {
      const response = await api(event('PATCH /plans/{planId}', { planId: created.planId, body }));
      expect(response.statusCode).toBe(400);
      expect(bodyOf(response).fields.length).toBeGreaterThan(0);
    }
    const bad = await api(event('PATCH /plans/{planId}', { planId: created.planId, rawBody: '{nope' }));
    expect(bad.statusCode).toBe(400);
  });

  it('names each field that cannot be edited and leaves the plan unchanged', async () => {
    const created = bodyOf(await submit());
    const response = await api(
      event('PATCH /plans/{planId}', { planId: created.planId, body: { title: 'ok', notes: 'no', travelers: 3 } }),
    );
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response).fields).toEqual([
      { field: 'notes', message: 'is not an editable field' },
      { field: 'travelers', message: 'is not an editable field' },
    ]);
    expect((await deps.store.getPlan(ALICE, created.planId))!.title).not.toBe('ok');
  });

  it("answers 404 for an unknown plan, a malformed id and another person's plan", async () => {
    const created = bodyOf(await submit());
    const body = { title: 'Mine now' };
    expect((await api(event('PATCH /plans/{planId}', { planId: deps.newPlanId(), body }))).statusCode).toBe(404);
    expect((await api(event('PATCH /plans/{planId}', { planId: 'nope', body }))).statusCode).toBe(404);
    expect((await api(event('PATCH /plans/{planId}', { planId: created.planId, body, sub: BOB }))).statusCode).toBe(
      404,
    );
    expect((await deps.store.getPlan(ALICE, created.planId))!.title).not.toBe('Mine now');
  });
});
