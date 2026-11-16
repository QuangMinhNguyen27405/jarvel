// Contract constants shared by backend (Lambda) and infra (CDK).

/** Counted plan requests allowed per person per calendar month, Boston time (FR6). */
export const MONTHLY_PLAN_LIMIT = 3;

/** A plan not finished this long after acceptance is FAILED (FR2.5, D2). */
export const PLAN_TIMEOUT_MS = 5 * 60 * 1000;

/** PlannerFn stops its own work after this long (D2: 4 min 30 s). */
export const PLANNER_SELF_STOP_MS = 4 * 60 * 1000 + 30 * 1000;

/** Idempotency keys expire after this many hours (D7). */
export const IDEMPOTENCY_TTL_HOURS = 24;

/** Plans are deleted automatically this many days after the trip's departure date (FR8.2). */
export const PLAN_RETENTION_DAYS = 90;

/** Safety-area id meaning "no safety information for this place" (FR4.5): scheduled before sunset only. */
export const UNKNOWN_SAFETY_AREA_ID = 'unknown';

/** Boston's IANA time zone. Every date and time in the API is local to it (FR3.4). */
export const BOSTON_TIME_ZONE = 'America/New_York';
