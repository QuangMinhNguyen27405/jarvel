import type { AddressInfo } from 'node:net';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { ListPlansResponse, PlanRecord, QuotaExceededBody } from '@jarvel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL } from '../scripts/demo.js';
import {
  createDevServer,
  DEFAULT_HOST,
  devUserId,
  SIGN_IN_NAME_PATTERN,
  type DemoAccount,
  type DevServer,
  type DevServerOptions,
} from '../scripts/dev-server.js';
import { loadBostonData } from '../src/lib/data.js';
import { isOpenFor, openRanges } from '../src/lib/hours.js';
import { parseHHMM } from '../src/lib/time.js';
import { validRequestBody } from './fixtures/requests.js';

let dev: DevServer | undefined;
afterEach(async () => {
  await dev?.close();
  dev = undefined;
});

/** Starts a dev server with no planner delay on a free port of `host`; returns its base URL and address. */
async function start(
  host = DEFAULT_HOST,
  options: DevServerOptions = {},
): Promise<{ base: string; address: AddressInfo }> {
  dev = createDevServer({ thinkMs: 0, ...options });
  const server = dev.server;
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const address = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${address.port}`, address };
}

/** A Boston-local date-time `days` from now, as the API expects (YYYY-MM-DDTHH:MM). */
function daysFromNow(days: number, time: string): string {
  return `${new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10)}T${time}`;
}

const as = (name: string) => ({ authorization: `Bearer dev-${name}`, 'content-type': 'application/json' });

describe('local dev server (R-09)', () => {
  it('listens on 127.0.0.1 by default, so only this computer can reach it', async () => {
    const { address } = await start();
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect(address.address).toBe('127.0.0.1');
  });

  it('answers the health check and the browser preflight with CORS headers', async () => {
    const { base } = await start();
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
    const preflight = await fetch(`${base}/plans`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PATCH');
  });

  it('refuses a request without a dev sign-in, and a malformed one', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/plans`)).status).toBe(401);
    expect((await fetch(`${base}/plans`, { headers: { authorization: 'Bearer someone' } })).status).toBe(401);
  });

  it('builds a plan end to end over HTTP and keeps it to its owner', async () => {
    const { base } = await start();
    const body = validRequestBody({ arrival: daysFromNow(7, '10:00'), departure: daysFromNow(9, '15:00') });
    const created = await fetch(`${base}/plans`, { method: 'POST', headers: as('amy'), body: JSON.stringify(body) });
    expect(created.status).toBe(202);
    const { planId } = (await created.json()) as { planId: string };

    let plan: PlanRecord | undefined;
    for (let attempt = 0; attempt < 50 && plan?.status !== 'SUCCEEDED'; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 50));
      plan = (await (await fetch(`${base}/plans/${planId}`, { headers: as('amy') })).json()) as PlanRecord;
      expect(plan.status).not.toBe('FAILED');
    }
    expect(plan?.status).toBe('SUCCEEDED');
    const located = plan!.itinerary!.days.flatMap((day) => day.items).filter((item) => item.location);
    expect(located.length).toBeGreaterThan(0); // the web app's map has something to show

    const amys = (await (await fetch(`${base}/plans`, { headers: as('amy') })).json()) as ListPlansResponse;
    expect(amys.plans.map((p) => p.planId)).toEqual([planId]);
    const bobs = (await (await fetch(`${base}/plans`, { headers: as('bob') })).json()) as ListPlansResponse;
    expect(bobs.plans).toEqual([]);
    expect((await fetch(`${base}/plans/${planId}`, { headers: as('bob') })).status).toBe(404);
  });
});

/** A fixed clock six days before the traveler's trip, so the demo trip is Nov 18 to Nov 21, 2026 on any day. */
const NOV_12 = () => new Date('2026-11-12T15:00:00Z');

/** The six entries of the traveler's list that are in the Boston data, by place id. */
const SIX_PLACES = [
  'blank-street-back-bay',
  'boston-sail-loft',
  'giulia',
  'mikes-pastry',
  'saltie-girl',
  'zhi-wei-cafe',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function listOf(base: string, name: string): Promise<ListPlansResponse> {
  const response = await fetch(`${base}/plans`, { headers: as(name) });
  expect(response.status).toBe(200);
  return (await response.json()) as ListPlansResponse;
}

async function demoOf(base: string): Promise<DemoAccount> {
  return (await (await fetch(`${base}/dev/demo`)).json()) as DemoAccount;
}

describe('local dev server: the demo account (Step 15)', () => {
  it('starts with the demo account, which signs in with its email and already has one finished trip', async () => {
    const { base } = await start(DEFAULT_HOST, { now: NOV_12 });
    const account = await dev!.demo;
    expect(account.user).toBe(DEMO_EMAIL);
    expect(dev!.demoUser).toBe(DEMO_EMAIL);
    expect(account.planId).toMatch(UUID);

    const { plans } = await listOf(base, DEMO_EMAIL);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      planId: account.planId,
      title: 'My Boston food trip',
      status: 'SUCCEEDED',
      arrival: '2026-11-18T10:00',
      departure: '2026-11-21T15:00',
    });
  });

  it("schedules six of the traveler's places, each once and inside its opening hours, and lists the seventh", async () => {
    const { base } = await start(DEFAULT_HOST, { now: NOV_12 });
    const { planId } = await dev!.demo;
    const response = await fetch(`${base}/plans/${planId}`, { headers: as(DEMO_EMAIL) });
    const plan = (await response.json()) as PlanRecord;
    expect(plan.status).toBe('SUCCEEDED');
    expect(plan.request.travelers).toBe(2);
    expect(plan.request.hotel.name).toBe('My hotel');
    const itinerary = plan.itinerary!;
    expect(itinerary.days.map((day) => day.date)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);

    const data = loadBostonData();
    const stops = itinerary.days.flatMap((day) =>
      day.items.filter((item) => item.placeId !== undefined).map((item) => ({ date: day.date, item })),
    );
    expect(stops.map((stop) => stop.item.placeId).sort()).toEqual(SIX_PLACES); // each exactly once, nothing else
    for (const { date, item } of stops) {
      const place = data.placeById.get(item.placeId!)!;
      expect(openRanges(place, date), `${place.name} has known hours on ${date}`).toBeDefined();
      const open = isOpenFor(place, date, parseHHMM(item.start), parseHHMM(item.end));
      expect(open, `${place.name} is open for all of ${item.start}-${item.end} on ${date}`).toBe(true);
      expect(item.isWishlist).toBe(true);
      expect(item.location).toEqual({ lat: place.lat, lng: place.lng }); // the web app's map can show it
    }
    expect(itinerary.unscheduled).toEqual([{ name: 'Quin Long - Malatang Hotpot', reason: 'not in the Boston data' }]);
  });

  it('names the account at GET /dev/demo without a sign-in, to a page on another origin', async () => {
    const { base } = await start(DEFAULT_HOST, { now: NOV_12 });
    expect((await demoOf(base)).user).toBe(DEMO_EMAIL); // named at once, while its trip may still be building
    const account = await dev!.demo;
    const response = await fetch(`${base}/dev/demo`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ user: DEMO_EMAIL, planId: account.planId });
    // Only GET is answered there; anything else is an unknown route of the API, which asks for a sign-in first.
    expect((await fetch(`${base}/dev/demo`, { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('keeps the demo trip to the demo account: another user still sees an empty list', async () => {
    const { base } = await start(DEFAULT_HOST, { now: NOV_12 });
    const { planId } = await dev!.demo;
    expect((await listOf(base, 'bob')).plans).toEqual([]);
    expect((await fetch(`${base}/plans/${planId}`, { headers: as('bob') })).status).toBe(404);
    expect((await fetch(`${base}/plans/${planId}`)).status).toBe(401);
  });

  it("counts the demo trip as one of the account's three plans for the month", async () => {
    const { base } = await start(DEFAULT_HOST, { now: NOV_12 });
    await dev!.demo;
    const post = () =>
      fetch(`${base}/plans`, { method: 'POST', headers: as(DEMO_EMAIL), body: JSON.stringify(validRequestBody()) });
    expect((await post()).status).toBe(202);
    expect((await post()).status).toBe(202);
    const refused = await post();
    expect(refused.status).toBe(429);
    expect((await refused.json()) as QuotaExceededBody).toMatchObject({ code: 'quota-exceeded', limit: 3, used: 3 });
    const other = await fetch(`${base}/plans`, {
      method: 'POST',
      headers: as('bob'),
      body: JSON.stringify(validRequestBody()),
    });
    expect(other.status).toBe(202); // another account's count is its own
  });

  it('uses another address for the demo account when one is given', async () => {
    const { base } = await start(DEFAULT_HOST, { now: NOV_12, demoEmail: 'demo.user+trip@example.com' });
    const account = await dev!.demo;
    expect(account).toEqual({ user: 'demo.user+trip@example.com', planId: expect.stringMatching(UUID) });
    expect(await demoOf(base)).toEqual(account);
    expect((await listOf(base, 'demo.user+trip@example.com')).plans.map((plan) => plan.planId)).toEqual([
      account.planId,
    ]);
    expect((await listOf(base, 'someone.else@example.com')).plans).toEqual([]);
  });

  it('starts empty with seedDemo: false', async () => {
    const { base } = await start(DEFAULT_HOST, { seedDemo: false });
    expect(dev!.demoUser).toBeNull();
    expect(await dev!.demo).toEqual({ user: null, planId: null });
    expect(await demoOf(base)).toEqual({ user: null, planId: null });
    expect((await listOf(base, DEMO_EMAIL)).plans).toEqual([]);
  });

  it('has no demo account when its address is not a usable sign-in name', async () => {
    const { base } = await start(DEFAULT_HOST, { demoEmail: 'not a sign-in name' });
    expect(dev!.demoUser).toBeNull();
    expect(await dev!.demo).toEqual({ user: null, planId: null });
    expect(await demoOf(base)).toEqual({ user: null, planId: null });
  });

  it('accepts an email address as the sign-in name', async () => {
    const { base } = await start(DEFAULT_HOST, { seedDemo: false });
    for (const name of ['amy@example.com', 'a.b_c+d-e@mail.example.org', 'A1', 'x'.repeat(80)]) {
      expect((await fetch(`${base}/plans`, { headers: as(name) })).status, name).toBe(200);
    }
  });

  it('refuses a sign-in name with a character outside the list, an empty one and one that is too long', async () => {
    const { base } = await start(DEFAULT_HOST, { seedDemo: false });
    const refusedNames = [
      'amy smith',
      'amy/bob',
      'amy:bob',
      'amy,bob',
      'amy#1',
      'amy%40example.com',
      "amy'",
      '<amy>',
      '',
      'x'.repeat(81),
    ];
    for (const name of refusedNames) {
      expect((await fetch(`${base}/plans`, { headers: as(name) })).status, JSON.stringify(name)).toBe(401);
      expect(devUserId(name), JSON.stringify(name)).toBeUndefined();
    }
    expect(devUserId('amy@example.com')).toBe('dev-amy@example.com');
    expect(SIGN_IN_NAME_PATTERN.test('amy@example.com\n')).toBe(false); // no trailing line break slips through
  });

  it('close waits for a demo trip that is still being built, then removes the stand-in for DynamoDB', async () => {
    const isStandIn = () => (DynamoDBDocumentClient.prototype.send as { isSinonProxy?: boolean }).isSinonProxy === true;
    const server = createDevServer({ thinkMs: 60, now: NOV_12 });
    dev = server;
    let settled = false;
    void server.demo.then(() => {
      settled = true;
    });
    expect(isStandIn()).toBe(true);
    const closing = server.close();
    expect(server.close()).toBe(closing); // a second close is the same close, not a second removal
    expect(settled).toBe(false); // the trip is still being built when close is asked
    await closing;
    expect(settled).toBe(true);
    expect((await server.demo).planId).toMatch(UUID);
    expect(isStandIn()).toBe(false);
  });
});
