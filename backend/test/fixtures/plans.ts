import type { PlanRecord } from '@jarvel/shared';
import { validTripRequest } from './requests.js';

export const ALICE = 'sub-alice-0001';
export const BOB = 'sub-bob-0002';

let counter = 0;

/** A fresh QUEUED plan for `userId`, accepted at `acceptedAt`. */
export function queuedPlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  counter += 1;
  const acceptedAt = overrides.acceptedAt ?? '2026-10-23T16:00:00.000Z';
  return {
    userId: ALICE,
    planId: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    version: 1,
    status: 'QUEUED',
    title: 'My Boston trip',
    request: validTripRequest(),
    revisions: [],
    progress: [],
    dataVersion: 'places@test,transit@test,safety@test',
    sourceCredits: ['Test credits'],
    aiCostUSD: 0,
    durationMs: null,
    acceptedAt,
    createdAt: acceptedAt,
    updatedAt: acceptedAt,
    ...overrides,
  };
}
