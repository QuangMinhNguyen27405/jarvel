import type { PlanStatus } from '@jarvel/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  DEMO_EMAIL,
  DEMO_WISHLIST,
  demoEmailFrom,
  demoTripDates,
  demoTripRequest,
  seedDemo,
  type SeedDemoOptions,
} from '../scripts/demo.js';
import type { ApiEvent } from '../src/handlers/api.js';
import { loadBostonData } from '../src/lib/data.js';
import { errorResponse, json, type HttpResponse } from '../src/lib/http.js';
import { DEFAULT_PREFERENCES, validateTripRequest } from '../src/lib/schemas.js';
import { listDates, weekdayOf } from '../src/lib/time.js';
import { TEST_NOW } from './fixtures/requests.js';

const data = loadBostonData();

/** Boston is five hours behind UTC in late November (EST), so 15:00Z is 10:00 in Boston. */
const boston = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-05:00`);

describe('the demo account', () => {
  it('is the DEMO_EMAIL environment variable when it is set, and a usable sign-in name otherwise', () => {
    expect(demoEmailFrom({ DEMO_EMAIL: ' someone@example.com ' })).toBe('someone@example.com');
    const fallback = demoEmailFrom({});
    expect(fallback).toMatch(/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$/);
    expect(demoEmailFrom({ DEMO_EMAIL: '   ' })).toBe(fallback);
    expect(DEMO_EMAIL).toBe(demoEmailFrom());
  });
});

describe('demoTripRequest (Step 15)', () => {
  it('passes the API validation unchanged, with the documented defaults filled in', () => {
    const body = demoTripRequest(TEST_NOW);
    const result = validateTripRequest(body, { now: TEST_NOW, data });
    expect(result).toEqual({
      ok: true,
      value: {
        ...body,
        hotel: { ...body.hotel, nearestStationId: 'state', walkMinutesToStation: 2 },
        preferences: DEFAULT_PREFERENCES,
      },
    });
    expect(body).toEqual({
      title: 'My Boston food trip',
      arrival: '2026-11-18T10:00',
      departure: '2026-11-21T15:00',
      travelers: 2,
      hotel: { name: 'My hotel', address: '1 Example St, Boston', lat: 42.3586, lng: -71.0585 },
      wishlist: [...DEMO_WISHLIST],
    });
  });

  it("has the traveler's seven entries in their exact wording", () => {
    expect(demoTripRequest(TEST_NOW).wishlist).toEqual([
      'Saltie Girl - Lobster Roll',
      'Blank Street - Coffee/Matcha',
      'Guilia - Italian',
      'Quin Long - Malatang Hotpot',
      'Sail Loft - Lobster Roll, seafood portofino',
      'Mike’s Pastry',
      'Zei Wei - Taiwan noodle',
    ]);
    expect(DEMO_WISHLIST[5]).toContain('’'); // the curly apostrophe the traveler typed, not a straight one
    expect(DEMO_WISHLIST[5]).not.toContain("'");
  });

  it('gives each caller its own wishlist, so a change to one request cannot leak into the next', () => {
    const first = demoTripRequest(TEST_NOW);
    first.wishlist.push('Something else');
    expect(demoTripRequest(TEST_NOW).wishlist).toHaveLength(7);
  });

  it('is Nov 18 10:00 to Nov 21 15:00, 2026 for as long as that arrival is still ahead', () => {
    const real = { arrival: '2026-11-18T10:00', departure: '2026-11-21T15:00' };
    expect(demoTripDates(TEST_NOW)).toEqual(real);
    expect(demoTripDates(boston('2026-11-17', '23:59'))).toEqual(real);
    expect(demoTripDates(boston('2026-11-18', '09:59'))).toEqual(real); // one minute before the arrival
  });

  it('moves to the next Wednesday-to-Saturday once the arrival is no longer ahead', () => {
    const nextWeek = { arrival: '2026-11-25T10:00', departure: '2026-11-28T15:00' };
    expect(demoTripDates(boston('2026-11-18', '10:00'))).toEqual(nextWeek); // on the arrival minute
    expect(demoTripDates(boston('2026-11-18', '18:00'))).toEqual(nextWeek);
    expect(demoTripDates(boston('2026-11-20', '12:00'))).toEqual(nextWeek);
    expect(demoTripDates(boston('2026-11-24', '10:00'))).toEqual(nextWeek); // exactly a day ahead
  });

  it('skips a Wednesday that is less than a day ahead', () => {
    const weekAfter = { arrival: '2026-12-02T10:00', departure: '2026-12-05T15:00' };
    expect(demoTripDates(boston('2026-11-24', '10:01'))).toEqual(weekAfter);
    expect(demoTripDates(boston('2026-11-25', '08:00'))).toEqual(weekAfter); // that Wednesday morning
    expect(demoTripDates(boston('2026-11-25', '12:00'))).toEqual(weekAfter);
  });

  it('always covers Wednesday to Saturday and passes validation, whenever it is asked', () => {
    const moments = [
      TEST_NOW,
      boston('2026-11-18', '09:59'),
      boston('2026-11-18', '10:00'),
      boston('2026-11-24', '23:30'),
      boston('2026-12-31', '23:59'), // across a year end
      new Date('2027-03-13T12:00:00-05:00'), // the day before clocks go forward
      new Date('2027-07-04T12:00:00-04:00'),
    ];
    for (const now of moments) {
      const body = demoTripRequest(now);
      const days = listDates(body.arrival.slice(0, 10), body.departure.slice(0, 10));
      expect(days.map(weekdayOf)).toEqual(['wed', 'thu', 'fri', 'sat']);
      expect(body.arrival.slice(11)).toBe('10:00');
      expect(body.departure.slice(11)).toBe('15:00');
      expect(validateTripRequest(body, { now, data })).toMatchObject({ ok: true });
    }
  });
});

const PLAN_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = 'dev-demo@example.com';

/** A stand-in for the API handler: answers POST /plans with `created`, then each read with the next status. */
function fakeApi(created: HttpResponse, reads: (HttpResponse | PlanStatus)[] = []) {
  const events: ApiEvent[] = [];
  const queue = [...reads];
  const api = async (event: ApiEvent): Promise<HttpResponse> => {
    events.push(event);
    if (event.routeKey === 'POST /plans') return created;
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return typeof next === 'string' ? json(200, { planId: PLAN_ID, status: next }) : next;
  };
  return { api, events };
}

function seedOptions(api: SeedDemoOptions['api'], extra: Partial<SeedDemoOptions> = {}) {
  const log = { info: vi.fn(), error: vi.fn() };
  const onAccepted = vi.fn();
  const options: SeedDemoOptions = { api, userId: USER_ID, now: () => TEST_NOW, log, onAccepted, pollMs: 1, ...extra };
  return { options, log, onAccepted };
}

const accepted = () => json(202, { planId: PLAN_ID, version: 1, status: 'QUEUED' });

describe('seedDemo (Step 15)', () => {
  it('asks for the demo trip as the demo account and waits until the plan is finished', async () => {
    const { api, events } = fakeApi(accepted(), ['QUEUED', 'RUNNING', 'SUCCEEDED']);
    const { options, log, onAccepted } = seedOptions(api);
    await expect(seedDemo(options)).resolves.toEqual({ ok: true, planId: PLAN_ID });

    const [post, ...reads] = events;
    expect(post!.routeKey).toBe('POST /plans');
    expect(post!.requestContext.authorizer.jwt.claims.sub).toBe(USER_ID);
    expect(JSON.parse(post!.body!)).toEqual(demoTripRequest(TEST_NOW));
    expect(reads.map((event) => event.routeKey)).toEqual(Array(3).fill('GET /plans/{planId}'));
    expect(reads.map((event) => event.pathParameters)).toEqual(Array(3).fill({ planId: PLAN_ID }));
    expect(reads.every((event) => event.requestContext.authorizer.jwt.claims.sub === USER_ID)).toBe(true);
    expect(onAccepted).toHaveBeenCalledExactlyOnceWith(PLAN_ID);
    expect(log.info).toHaveBeenCalledExactlyOnceWith('demo trip ready', { planId: PLAN_ID });
    expect(log.error).not.toHaveBeenCalled();
  });

  it('reports a refused request without throwing, and never reads a plan', async () => {
    const refused = errorResponse(429, 'quota-exceeded', 'You have used all 3 plans for this month.');
    const { api, events } = fakeApi(refused);
    const { options, log, onAccepted } = seedOptions(api);
    const result = await seedDemo(options);
    expect(result).toEqual({
      ok: false,
      planId: null,
      reason: 'the request was answered with status 429: You have used all 3 plans for this month.',
    });
    expect(events).toHaveLength(1);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledExactlyOnceWith('demo trip could not be built', {
      planId: null,
      reason: result.ok ? '' : result.reason,
    });
    expect(log.info).not.toHaveBeenCalled();
  });

  it('reports an answer it cannot read as refused', async () => {
    const { api } = fakeApi({ statusCode: 202, body: 'not json' });
    const { options } = seedOptions(api);
    expect(await seedDemo(options)).toEqual({
      ok: false,
      planId: null,
      reason: 'the request was answered with status 202',
    });
    const { api: empty } = fakeApi({ statusCode: 500 });
    expect(await seedDemo(seedOptions(empty).options)).toMatchObject({ ok: false, planId: null });
    const { api: list } = fakeApi({ statusCode: 202, body: '[]' });
    expect(await seedDemo(seedOptions(list).options)).toMatchObject({ ok: false, planId: null });
  });

  it('reports a plan that failed with its plain reason', async () => {
    const failed = json(200, { planId: PLAN_ID, status: 'FAILED', error: 'Your plan took too long.' });
    const { api } = fakeApi(accepted(), ['RUNNING', failed]);
    const { options, log, onAccepted } = seedOptions(api);
    expect(await seedDemo(options)).toEqual({ ok: false, planId: PLAN_ID, reason: 'Your plan took too long.' });
    expect(onAccepted).toHaveBeenCalledExactlyOnceWith(PLAN_ID);
    expect(log.error).toHaveBeenCalledOnce();

    const noReason = fakeApi(accepted(), ['FAILED']);
    expect(await seedDemo(seedOptions(noReason.api).options)).toEqual({
      ok: false,
      planId: PLAN_ID,
      reason: 'the plan failed',
    });
  });

  it('reports a plan it can no longer read', async () => {
    const { api } = fakeApi(accepted(), ['QUEUED', errorResponse(404, 'not-found', 'No such plan.')]);
    expect(await seedDemo(seedOptions(api).options)).toEqual({
      ok: false,
      planId: PLAN_ID,
      reason: 'reading the plan was answered with status 404',
    });
  });

  it('gives up on a plan that is not finished in time', async () => {
    const { api, events } = fakeApi(accepted(), ['RUNNING']);
    const { options, log } = seedOptions(api, { timeoutMs: 100 });
    expect(await seedDemo(options)).toEqual({
      ok: false,
      planId: PLAN_ID,
      reason: 'the plan was not finished in time',
    });
    expect(events.length).toBeGreaterThan(2); // it looked more than once before giving up
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('reports a crash of the handler instead of throwing', async () => {
    const crash = async (): Promise<HttpResponse> => {
      throw new Error('table unavailable');
    };
    const { options, log } = seedOptions(crash);
    await expect(seedDemo(options)).resolves.toEqual({ ok: false, planId: null, reason: 'table unavailable' });
    expect(log.error).toHaveBeenCalledOnce();

    const odd = (): Promise<HttpResponse> => Promise.reject('not an Error');
    expect(await seedDemo(seedOptions(odd).options)).toEqual({ ok: false, planId: null, reason: 'not an Error' });
  });
});
