// Builds one plan end to end (D2, D3): marks it RUNNING, asks the AI once, schedules, validates with fixed rules,
// and saves SUCCEEDED with the data version, credits, AI cost and duration. Any failure saves FAILED with a plain
// reason and gives the monthly count back (FR6.1, D6). Work stops itself at 4 min 30 s (FR2.5).
import {
  PLAN_TIMEOUT_MS,
  PLANNER_SELF_STOP_MS,
  type AgentName,
  type AgentProgress,
  type PlanFailureKind,
  type PlanRecord,
  type PlanStatus,
} from '@jarvel/shared';
import { AiError, chooseStops, type ConverseFn, type ModelPrices } from './ai.js';
import type { BostonData } from './data.js';
import type { Logger, Metrics } from './log.js';
import type { QuotaStore } from './quota.js';
import { buildItinerary, NoPlanError, resolveWishlist } from './scheduler.js';
import type { PlanStore } from './store.js';
import { bostonMonthKey, listDates } from './time.js';
import { validateItinerary } from './validator.js';

/** Plain-language reasons shown to the traveler. They never contain internal details (AC3.2.3). */
export const FAILURE_REASONS: Record<PlanFailureKind, string> = {
  timeout:
    'Your plan took too long to build and was stopped. Your monthly plan count was given back, so please try again.',
  'ai-error':
    'The planning assistant could not produce a usable answer. Your monthly plan count was given back, so please try again.',
  internal:
    'Something went wrong on our side while building your plan. Your monthly plan count was given back, so please try again.',
  'no-plan':
    'We could not build a plan that works by public transport for these dates and times. Your monthly plan count was given back.',
};

export class DeadlineError extends Error {
  constructor() {
    super('The plan build reached its time limit');
    this.name = 'DeadlineError';
  }
}

export interface FailureDeps {
  store: PlanStore;
  quota: QuotaStore;
  log: Logger;
  metrics: Metrics;
  now: () => Date;
}

export interface PlannerDeps extends FailureDeps {
  data: BostonData;
  converse: ConverseFn;
  modelId: string;
  prices: ModelPrices;
  selfStopMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** The scheduler; replaceable only so tests can prove the final check stops a rule-breaking plan. */
  schedule?: typeof buildItinerary;
}

/** True when an unfinished plan is past its 5-minute limit (D2: shown as FAILED, count given back). */
export function isOverdue(plan: PlanRecord, now: Date): boolean {
  const unfinished = plan.status === 'QUEUED' || plan.status === 'RUNNING';
  return unfinished && now.getTime() - Date.parse(plan.acceptedAt) > PLAN_TIMEOUT_MS;
}

/**
 * Moves a plan to FAILED with a plain reason and refunds its count, both in one DynamoDB transaction, so the
 * refund cannot be lost between the two writes (FR6.1). Only the caller that wins the transition refunds, so a
 * plan is never refunded twice. Returns whether this caller failed the plan.
 */
export async function failPlan(
  deps: FailureDeps,
  plan: PlanRecord,
  kind: PlanFailureKind,
  extra: Pick<Partial<PlanRecord>, 'aiCostUSD' | 'progress'> = {},
): Promise<boolean> {
  const durationMs = deps.now().getTime() - Date.parse(plan.acceptedAt);
  const patch = {
    error: FAILURE_REASONS[kind],
    failureKind: kind,
    durationMs,
    aiCostUSD: extra.aiCostUSD ?? plan.aiCostUSD,
    ...(extra.progress ? { progress: extra.progress } : {}),
  };
  const month = bostonMonthKey(new Date(plan.acceptedAt));
  const transition = deps.store.transitionOperation(plan.userId, plan.planId, 'FAILED', patch);
  const outcome = await deps.quota.refundWithTransition(transition, plan.userId, month);
  if (outcome === 'not-moved') return false;
  if (outcome === 'nothing-to-refund') {
    // The month has no count left to give back (for example the account's counts were moved to a hold), so the
    // plan still fails, on its own.
    if (!(await deps.store.transitionPlan(plan.userId, plan.planId, 'FAILED', patch))) return false;
    deps.log.warn('no count to give back for failed plan', { planId: plan.planId, month });
  }
  deps.metrics.count('PlansFailed');
  deps.log.info('plan status changed', { planId: plan.planId, status: 'FAILED', failureKind: kind, durationMs });
  return true;
}

const STEPS: { agent: AgentName; summary: string }[] = [
  { agent: 'researcher', summary: 'Chose and ordered your stops' },
  { agent: 'scheduler', summary: 'Timed each day' },
  { agent: 'transit', summary: 'Planned public transport between stops' },
  { agent: 'critic', summary: 'Checked the finished plan with fixed rules' },
];

function progressAt(done: number, now: Date, failed = false): AgentProgress[] {
  return STEPS.map((step, index) => {
    if (index < done)
      return { agent: step.agent, status: 'done', finishedAt: now.toISOString(), summary: step.summary };
    if (index === done)
      return { agent: step.agent, status: failed ? 'failed' : 'running', startedAt: now.toISOString() };
    return { agent: step.agent, status: failed ? 'skipped' : 'pending' };
  });
}

function classify(error: unknown): PlanFailureKind {
  if (error instanceof DeadlineError) return 'timeout';
  if (error instanceof AiError) return 'ai-error';
  if (error instanceof NoPlanError) return 'no-plan';
  return 'internal';
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

interface BuildState {
  aiCostUSD: number;
  stage: number;
}

async function build(plan: PlanRecord, deps: PlannerDeps, signal: AbortSignal, state: BuildState) {
  const request = plan.request;
  const dates = listDates(request.arrival.slice(0, 10), request.departure.slice(0, 10));
  const wishlistPlaceIds = resolveWishlist(request, deps.data).flatMap((entry) =>
    entry.placeId && entry.duplicateOf === undefined ? [entry.placeId] : [],
  );
  try {
    const ai = await chooseStops(
      { request, dates, wishlistPlaceIds, catalog: deps.data.places },
      { converse: deps.converse, modelId: deps.modelId, prices: deps.prices, abortSignal: signal, sleep: deps.sleep },
    );
    state.aiCostUSD = ai.costUSD;
    signal.throwIfAborted();
    state.stage = 1;
    await deps.store.updateProgress(plan.userId, plan.planId, progressAt(1, deps.now()));
    const schedule = deps.schedule ?? buildItinerary;
    const itinerary = schedule({
      request,
      data: deps.data,
      selection: ai.selection,
      modelId: deps.modelId,
      generatedAt: deps.now().toISOString(),
    });
    state.stage = STEPS.length - 1;
    const violations = validateItinerary(itinerary, request, deps.data);
    if (violations.length > 0) {
      deps.log.warn('plan failed the final fixed-rule check', {
        planId: plan.planId,
        violations: violations.slice(0, 10).map((v) => `${v.rule}: ${v.message}`),
      });
      throw new NoPlanError(`${violations.length} rule violation(s) in the finished plan`);
    }
    return itinerary;
  } catch (error) {
    if (error instanceof AiError) state.aiCostUSD = error.costUSD;
    throw error;
  }
}

/** Runs one plan. Returns the final status this run saved, or 'skipped' when there was nothing to do. */
export async function runPlanner(
  event: { userId: string; planId: string },
  deps: PlannerDeps,
): Promise<PlanStatus | 'skipped'> {
  const plan = await deps.store.getPlan(event.userId, event.planId);
  if (!plan) {
    deps.log.warn('plan to build was not found', { planId: event.planId });
    return 'skipped';
  }
  if (plan.status !== 'QUEUED') {
    deps.log.warn('plan is not QUEUED, nothing to do', { planId: plan.planId, status: plan.status });
    return 'skipped';
  }
  const startedAt = deps.now();
  if (isOverdue(plan, startedAt)) return (await failPlan(deps, plan, 'timeout')) ? 'FAILED' : 'skipped';
  const running = await deps.store.transitionPlan(plan.userId, plan.planId, 'RUNNING', {
    progress: progressAt(0, startedAt),
  });
  if (!running) return 'skipped';
  deps.log.info('plan status changed', { planId: plan.planId, status: 'RUNNING' });

  const acceptedMs = Date.parse(plan.acceptedAt);
  const deadline = Math.min(
    startedAt.getTime() + (deps.selfStopMs ?? PLANNER_SELF_STOP_MS),
    acceptedMs + PLAN_TIMEOUT_MS - 10_000,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DeadlineError()), Math.max(0, deadline - startedAt.getTime()));
  const state: BuildState = { aiCostUSD: 0, stage: 0 };
  try {
    const itinerary = await Promise.race([
      build(plan, deps, controller.signal, state),
      rejectOnAbort(controller.signal),
    ]);
    const finishedAt = deps.now();
    const durationMs = finishedAt.getTime() - acceptedMs;
    const saved = await deps.store.transitionPlan(plan.userId, plan.planId, 'SUCCEEDED', {
      itinerary,
      dataVersion: deps.data.dataVersion,
      sourceCredits: deps.data.sourceCredits,
      aiCostUSD: state.aiCostUSD,
      durationMs,
      progress: progressAt(STEPS.length, finishedAt),
    });
    if (!saved) {
      deps.log.warn('plan was already finished elsewhere; result discarded', { planId: plan.planId });
      return 'skipped';
    }
    deps.metrics.count('PlansSucceeded');
    deps.metrics.measure('PlanDurationMs', durationMs, 'Milliseconds');
    deps.metrics.measure('PlanAiCostUSD', state.aiCostUSD, 'None');
    deps.log.info('plan status changed', {
      planId: plan.planId,
      status: 'SUCCEEDED',
      durationMs,
      aiCostUSD: state.aiCostUSD,
    });
    return 'SUCCEEDED';
  } catch (error) {
    const kind = classify(error);
    const logFields = { planId: plan.planId, failureKind: kind, error: error instanceof Error ? error : String(error) };
    if (kind === 'internal') deps.log.error('plan build crashed', logFields);
    else deps.log.warn('plan build failed', logFields);
    const failed = await failPlan(deps, plan, kind, {
      aiCostUSD: state.aiCostUSD,
      progress: progressAt(state.stage, deps.now(), true),
    });
    return failed ? 'FAILED' : 'skipped';
  } finally {
    clearTimeout(timer);
  }
}
