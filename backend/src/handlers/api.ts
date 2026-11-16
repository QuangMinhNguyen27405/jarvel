// ApiFn: every HTTP route (D9). API Gateway's Cognito JWT authorizer guards every route except /health; this
// handler still refuses a request without a `sub` claim (defense in depth), and one whose `sub` carries the
// deleted-account marker (FR8.1). The user id is always the JWT `sub`, so a plan id belonging to someone else
// answers exactly like an unknown one (FR1.5).
import { randomUUID } from 'node:crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { CreatePlanResponse, ListPlansResponse, PlanRecord, QuotaExceededBody } from '@jarvel/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { loadBostonData, type BostonData } from '../lib/data.js';
import { AccountDeletedError, createDocumentClient, requiredEnv } from '../lib/dynamo.js';
import {
  errorResponse,
  json,
  markdown,
  noContent,
  notFound,
  serverError,
  unauthorized,
  type HttpResponse,
} from '../lib/http.js';
import { IDEMPOTENCY_KEY_PATTERN, IdempotencyStore, requestHash } from '../lib/idempotency.js';
import { createLogger, createMetrics, type Logger, type Metrics } from '../lib/log.js';
import { renderPlanMarkdown } from '../lib/markdown.js';
import { failPlan, isOverdue } from '../lib/planner.js';
import { QuotaStore, type QuotaReservation } from '../lib/quota.js';
import { defaultTitle, validateRenameRequest, validateTripRequest } from '../lib/schemas.js';
import { PlanStore } from '../lib/store.js';

export type ApiEvent = APIGatewayProxyEventV2WithJWTAuthorizer;

export interface ApiDeps {
  store: PlanStore;
  quota: QuotaStore;
  idempotency: IdempotencyStore;
  data: BostonData;
  invokePlanner: (event: { userId: string; planId: string }) => Promise<void>;
  newPlanId: () => string;
  now: () => Date;
  log: Logger;
  metrics: Metrics;
}

const MAX_BODY_BYTES = 64 * 1024;
const PLAN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function userIdOf(event: ApiEvent): string | undefined {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : undefined;
}

function header(event: ApiEvent, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const entry = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === wanted);
  return entry?.[1];
}

function readBody(event: ApiEvent): { ok: true; value: unknown } | { ok: false; response: HttpResponse } {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse(413, 'request-too-large', 'The request body is larger than 64 KB.') };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, response: errorResponse(400, 'invalid-json', 'The request body is not valid JSON.') };
  }
}

function created(plan: Pick<PlanRecord, 'planId' | 'version' | 'status'>, replayed = false): HttpResponse {
  const body: CreatePlanResponse = { planId: plan.planId, version: plan.version, status: plan.status };
  return json(202, body, replayed ? { 'idempotent-replayed': 'true' } : {});
}

async function createPlan(event: ApiEvent, userId: string, deps: ApiDeps): Promise<HttpResponse> {
  const body = readBody(event);
  if (!body.ok) return body.response;
  const key = header(event, 'idempotency-key');
  const keyError = key !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(key);
  const now = deps.now();
  const validation = validateTripRequest(body.value, { now, data: deps.data });
  if (keyError || !validation.ok) {
    const fields = [
      ...(keyError ? [{ field: 'Idempotency-Key', message: 'must be 1 to 128 letters, digits or . _ : -' }] : []),
      ...(validation.ok ? [] : validation.fields),
    ];
    return errorResponse(400, 'invalid-request', 'The request has invalid fields.', fields);
  }
  const planId = deps.newPlanId();
  if (key !== undefined) {
    const bodyHash = requestHash(body.value);
    const claim = await deps.idempotency.claim(userId, key, bodyHash, planId, now);
    if (claim.outcome === 'conflict') {
      return errorResponse(
        409,
        'idempotency-conflict',
        'This Idempotency-Key was already used with a different request.',
      );
    }
    if (claim.outcome === 'replay') {
      const existing = await deps.store.getPlan(userId, claim.planId);
      if (existing) return created(existing, true);
      // The key's plan is missing. While the first request may still be running, ask the client to wait; once it
      // has settled, the plan was never stored or was deleted, so the key is released to this request as new.
      const released =
        claim.settled &&
        (await deps.idempotency.takeOver(userId, key, { bodyHash, stalePlanId: claim.planId, planId }, now));
      if (!released) {
        return errorResponse(
          409,
          'request-in-progress',
          'A request with this Idempotency-Key is still being processed. Retry shortly.',
        );
      }
    }
  }
  let reservation: QuotaReservation;
  try {
    reservation = await deps.quota.reserve(userId, now);
  } catch (error) {
    // Nothing was counted (for example the account's deletion started a moment ago): free the key for a retry.
    if (key !== undefined) await deps.idempotency.release(userId, key);
    throw error;
  }
  if (!reservation.accepted) {
    if (key !== undefined) await deps.idempotency.release(userId, key);
    const refused: QuotaExceededBody = {
      error: `You have used all ${reservation.limit} plans for this month. The count resets on ${reservation.resetsOn}.`,
      code: 'quota-exceeded',
      limit: reservation.limit,
      used: reservation.used,
      resetsOn: reservation.resetsOn,
    };
    return json(429, refused);
  }
  const acceptedAt = now.toISOString();
  const record: PlanRecord = {
    userId,
    planId,
    version: 1,
    status: 'QUEUED',
    title: defaultTitle(validation.value),
    request: validation.value,
    revisions: [],
    progress: [],
    dataVersion: deps.data.dataVersion,
    sourceCredits: deps.data.sourceCredits,
    aiCostUSD: 0,
    durationMs: null,
    acceptedAt,
    createdAt: acceptedAt,
    updatedAt: acceptedAt,
  };
  try {
    await deps.store.createPlan(record);
  } catch (error) {
    await deps.quota.refund(userId, reservation.month);
    if (key !== undefined) await deps.idempotency.release(userId, key);
    throw error;
  }
  try {
    await deps.invokePlanner({ userId, planId });
  } catch (error) {
    deps.log.error('could not start the planner', { planId, error: error as Error });
    await failPlan(deps, record, 'internal');
    return errorResponse(
      503,
      'planner-unavailable',
      'The planner could not be started. Your monthly count was given back.',
    );
  }
  deps.log.info('plan accepted', { planId, status: 'QUEUED' });
  return created(record);
}

function wantsMarkdown(event: ApiEvent): boolean {
  if (event.queryStringParameters?.format === 'markdown') return true;
  return (header(event, 'accept') ?? '').toLowerCase().includes('text/markdown');
}

async function getPlan(event: ApiEvent, userId: string, planId: string, deps: ApiDeps): Promise<HttpResponse> {
  let plan = await deps.store.getPlan(userId, planId);
  if (!plan) return notFound();
  if (isOverdue(plan, deps.now())) {
    await failPlan(deps, plan, 'timeout');
    plan = (await deps.store.getPlan(userId, planId)) ?? plan;
  }
  return wantsMarkdown(event) ? markdown(200, renderPlanMarkdown(plan)) : json(200, plan);
}

async function listPlans(userId: string, deps: ApiDeps): Promise<HttpResponse> {
  const now = deps.now();
  const plans = await deps.store.listPlans(userId);
  for (const [index, plan] of plans.entries()) {
    if (!isOverdue(plan, now)) continue;
    await failPlan(deps, plan, 'timeout');
    plans[index] = (await deps.store.getPlan(userId, plan.planId)) ?? plan;
  }
  const body: ListPlansResponse = {
    plans: plans.map((plan) => ({
      planId: plan.planId,
      title: plan.title,
      status: plan.status,
      version: plan.version,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      arrival: plan.request.arrival,
      departure: plan.request.departure,
    })),
  };
  return json(200, body);
}

async function renamePlan(event: ApiEvent, userId: string, planId: string, deps: ApiDeps): Promise<HttpResponse> {
  const body = readBody(event);
  if (!body.ok) return body.response;
  const validation = validateRenameRequest(body.value);
  if (!validation.ok) {
    return errorResponse(400, 'invalid-request', 'The request has invalid fields.', validation.fields);
  }
  const renamed = await deps.store.renamePlan(userId, planId, validation.title);
  if (!renamed) return notFound();
  deps.log.info('plan renamed', { planId });
  return getPlan(event, userId, planId, { ...deps });
}

async function deletePlan(userId: string, planId: string, deps: ApiDeps): Promise<HttpResponse> {
  const deleted = await deps.store.deletePlan(userId, planId);
  if (!deleted) return notFound();
  deps.log.info('plan deleted', { planId });
  return noContent();
}

export function createApiHandler(deps: ApiDeps): (event: ApiEvent) => Promise<HttpResponse> {
  return async (event) => {
    try {
      if (event.routeKey === 'GET /health') return json(200, { status: 'ok' });
      const userId = userIdOf(event);
      if (!userId) return unauthorized();
      // A deleted account's access token can stay valid for up to an hour (D8); its id is refused before anything
      // is read or written for it (FR8.1).
      if (await deps.store.isAccountDeleted(userId)) {
        deps.log.warn('request from a deleted account refused', { routeKey: event.routeKey });
        return unauthorized();
      }
      const planId = event.pathParameters?.planId ?? '';
      switch (event.routeKey) {
        case 'POST /plans':
          return await createPlan(event, userId, deps);
        case 'GET /plans':
          return await listPlans(userId, deps);
        case 'PATCH /plans/{planId}':
          return PLAN_ID_PATTERN.test(planId) ? await renamePlan(event, userId, planId, deps) : notFound();
        case 'GET /plans/{planId}':
          return PLAN_ID_PATTERN.test(planId) ? await getPlan(event, userId, planId, deps) : notFound();
        case 'DELETE /plans/{planId}':
          return PLAN_ID_PATTERN.test(planId) ? await deletePlan(userId, planId, deps) : notFound();
        default:
          return errorResponse(404, 'route-not-found', 'No such route.');
      }
    } catch (error) {
      if (error instanceof AccountDeletedError) {
        // The account's deletion started while this request was running; its writes were refused (R-08).
        deps.log.warn('request from an account deleted while it ran refused', { routeKey: event.routeKey });
        return unauthorized();
      }
      deps.log.error('request failed', { routeKey: event.routeKey, error: error as Error });
      deps.metrics.count('ApiErrors');
      return serverError();
    }
  };
}

/** Starts PlannerFn asynchronously (InvocationType Event) with the plan's owner and id. */
export function lambdaPlannerInvoker(lambda: LambdaClient, functionName: string): ApiDeps['invokePlanner'] {
  return async (payload) => {
    const result = await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
    if (result.StatusCode !== undefined && result.StatusCode !== 202) {
      throw new Error(`Planner invoke returned status ${result.StatusCode}`);
    }
  };
}

/** Production wiring from the Lambda environment (TABLE_NAME, PLANNER_FUNCTION_NAME, STAGE). */
export function defaultApiDeps(): ApiDeps {
  const tableName = requiredEnv('TABLE_NAME');
  const plannerFunction = requiredEnv('PLANNER_FUNCTION_NAME');
  const stage = process.env.STAGE ?? 'unknown';
  const doc = createDocumentClient();
  return {
    store: new PlanStore(doc, tableName),
    quota: new QuotaStore(doc, tableName),
    idempotency: new IdempotencyStore(doc, tableName),
    data: loadBostonData(),
    invokePlanner: lambdaPlannerInvoker(new LambdaClient({ region: process.env.AWS_REGION }), plannerFunction),
    newPlanId: () => randomUUID(),
    now: () => new Date(),
    log: createLogger({ service: 'api', stage }),
    metrics: createMetrics(stage),
  };
}

let wired: ((event: ApiEvent) => Promise<HttpResponse>) | undefined;

export const handler = (event: ApiEvent): Promise<HttpResponse> => {
  wired ??= createApiHandler(defaultApiDeps());
  return wired(event);
};
