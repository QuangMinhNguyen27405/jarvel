// The local demo account and its demo trip (plan Step 15). Local development only: scripts/dev-server.ts uses this
// file, and it is never deployed. It is the ONE place the demo address is written. The web app learns the address
// from the local server (GET /dev/demo), so it is not built into the deployable web app or the Lambda code.
import type { HotelInfo, PlanRecord } from '@jarvel/shared';
import type { ApiEvent } from '../src/handlers/api.js';
import type { HttpResponse } from '../src/lib/http.js';
import type { Logger } from '../src/lib/log.js';
import { addDays, bostonDate, bostonLocalDateTime, weekdayOf } from '../src/lib/time.js';

/** The demo account's address unless the DEMO_EMAIL environment variable names another one. */
export function demoEmailFrom(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEMO_EMAIL?.trim() || 'demo@example.com';
}

/** The demo account. On the local server it is a sign-in name like any other, not a Cognito account. */
export const DEMO_EMAIL = demoEmailFrom();

/** The traveler's own list, exactly as written. The sixth entry has a curly apostrophe (U+2019). */
export const DEMO_WISHLIST: readonly string[] = [
  'Saltie Girl - Lobster Roll',
  'Blank Street - Coffee/Matcha',
  'Guilia - Italian',
  'Quin Long - Malatang Hotpot',
  'Sail Loft - Lobster Roll, seafood portofino',
  'Mike’s Pastry',
  'Zei Wei - Taiwan noodle',
];

/** The traveler's real trip. The demo uses these dates for as long as the arrival is still ahead. */
const TRIP_ARRIVAL = '2026-11-18T10:00';
const TRIP_DEPARTURE = '2026-11-21T15:00';

/** A request body as the web app's form sends it: the server fills the nearest station and the preferences. */
export interface DemoTripBody {
  title: string;
  arrival: string;
  departure: string;
  travelers: number;
  hotel: Pick<HotelInfo, 'name' | 'address' | 'lat' | 'lng'>;
  wishlist: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The demo trip's dates: Nov 18 10:00 to Nov 21 15:00, 2026 while that arrival is still ahead (Boston time). After
 * that, the next Wednesday 10:00 to Saturday 15:00 whose arrival is at least a day ahead, so the demo keeps working
 * and its days stay the same weekdays (opening hours differ by weekday).
 */
export function demoTripDates(now: Date): { arrival: string; departure: string } {
  if (bostonLocalDateTime(now) < TRIP_ARRIVAL) return { arrival: TRIP_ARRIVAL, departure: TRIP_DEPARTURE };
  const aDayAhead = bostonLocalDateTime(new Date(now.getTime() + MS_PER_DAY));
  let wednesday = bostonDate(now);
  while (weekdayOf(wednesday) !== 'wed' || `${wednesday}T10:00` < aDayAhead) wednesday = addDays(wednesday, 1);
  return { arrival: `${wednesday}T10:00`, departure: `${addDays(wednesday, 3)}T15:00` };
}

/**
 * The demo trip request: two travelers, the web form's placeholder hotel near State station (the traveler has not
 * named one), the traveler's seven entries and the default preferences.
 */
export function demoTripRequest(now: Date): DemoTripBody {
  return {
    title: 'My Boston food trip',
    ...demoTripDates(now),
    travelers: 2,
    hotel: { name: 'My hotel', address: '1 Example St, Boston', lat: 42.3586, lng: -71.0585 },
    wishlist: [...DEMO_WISHLIST],
  };
}

export interface SeedDemoOptions {
  /** The API handler every other request goes through, so the demo trip is validated, counted and built like any plan. */
  api: (event: ApiEvent) => Promise<HttpResponse>;
  /** The signed-in user id the demo trip belongs to. */
  userId: string;
  now: () => Date;
  log: Pick<Logger, 'info' | 'error'>;
  /** Called with the plan id as soon as the request is accepted, before the plan is built. */
  onAccepted?: (planId: string) => void;
  /** The wait before looking again whether the plan is finished. It doubles each time, up to half a second. */
  pollMs?: number;
  /** How long to keep looking before giving up. */
  timeoutMs?: number;
}

export type SeedDemoResult = { ok: true; planId: string } | { ok: false; planId: string | null; reason: string };

const DEFAULT_POLL_MS = 20;
const MAX_POLL_MS = 500;
const DEFAULT_TIMEOUT_MS = 60_000;

/** An API Gateway event as the JWT authorizer would deliver it for `userId`. */
function demoEvent(routeKey: string, userId: string, extra: { planId?: string; body?: unknown } = {}): ApiEvent {
  return {
    routeKey,
    headers: extra.body === undefined ? {} : { 'content-type': 'application/json' },
    body: extra.body === undefined ? undefined : JSON.stringify(extra.body),
    isBase64Encoded: false,
    pathParameters: extra.planId ? { planId: extra.planId } : undefined,
    queryStringParameters: {},
    requestContext: { authorizer: { jwt: { claims: { sub: userId }, scopes: [] } } },
  } as unknown as ApiEvent;
}

function parseBody(response: HttpResponse): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(response.body ?? '');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function requestAndWait(options: SeedDemoOptions): Promise<SeedDemoResult> {
  const created = await options.api(demoEvent('POST /plans', options.userId, { body: demoTripRequest(options.now()) }));
  const accepted = parseBody(created);
  if (created.statusCode !== 202 || typeof accepted.planId !== 'string') {
    const said = typeof accepted.error === 'string' ? `: ${accepted.error}` : '';
    return { ok: false, planId: null, reason: `the request was answered with status ${created.statusCode}${said}` };
  }
  const planId = accepted.planId;
  options.onAccepted?.(planId);
  let pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const giveUpAt = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  for (;;) {
    const read = await options.api(demoEvent('GET /plans/{planId}', options.userId, { planId }));
    if (read.statusCode !== 200) {
      return { ok: false, planId, reason: `reading the plan was answered with status ${read.statusCode}` };
    }
    const plan = parseBody(read) as Partial<PlanRecord>;
    if (plan.status === 'SUCCEEDED') return { ok: true, planId };
    if (plan.status === 'FAILED') return { ok: false, planId, reason: plan.error ?? 'the plan failed' };
    if (Date.now() >= giveUpAt) return { ok: false, planId, reason: 'the plan was not finished in time' };
    await sleep(pollMs);
    pollMs = Math.min(pollMs * 2, MAX_POLL_MS);
  }
}

/**
 * Creates the demo trip for `userId` through the API handler and waits until it is no longer QUEUED or RUNNING. It
 * uses one of the account's three plans for the month, like any plan. It never throws: a failure is logged and
 * returned, so it cannot stop the local server.
 */
export async function seedDemo(options: SeedDemoOptions): Promise<SeedDemoResult> {
  let result: SeedDemoResult;
  try {
    result = await requestAndWait(options);
  } catch (error) {
    result = { ok: false, planId: null, reason: error instanceof Error ? error.message : String(error) };
  }
  if (result.ok) options.log.info('demo trip ready', { planId: result.planId });
  else options.log.error('demo trip could not be built', { planId: result.planId, reason: result.reason });
  return result;
}
