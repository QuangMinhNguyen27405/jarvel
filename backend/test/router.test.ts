import type { Line, TransitLeg } from '@jarvel/shared';
import { describe, expect, it } from 'vitest';
import { loadBostonData } from '../src/lib/data.js';
import {
  boardingTime,
  headwayAt,
  indexNetwork,
  placeLocation,
  planRoute,
  pointLocation,
  serviceWindow,
  type Location,
  type RouteQuery,
} from '../src/lib/router.js';
import { parseHHMM } from '../src/lib/time.js';
import { line, sampleDataWith } from './fixtures/data.js';
import { DOWNTOWN_HOTEL } from './fixtures/requests.js';

const data = loadBostonData();
const index = indexNetwork(data.network);
const hotel = pointLocation('hotel', DOWNTOWN_HOTEL.name, DOWNTOWN_HOTEL, data.network, 15);
const place = (id: string, maxWalk = 15): Location => placeLocation(data.placeById.get(id)!, data.network, maxWalk);
const query = (to: Location, departAt: number, overrides: Partial<RouteQuery> = {}): RouteQuery => ({
  from: hotel,
  to,
  departAt,
  date: '2026-11-19', // a Thursday
  maxWalkMinutes: 15,
  ...overrides,
});

function expectConnected(leg: TransitLeg) {
  // Every ride or transfer starts where the previous step ended (AC4.6.1).
  let at: string | undefined;
  for (const step of leg.steps) {
    if (step.fromStationId && at) expect(step.fromStationId).toBe(at);
    if (step.toStationId) at = step.toStationId;
    else if (step.kind === 'walk') at = undefined;
  }
}

describe('planRoute (FR5, FR5.4)', () => {
  it('joins two places with walk, wait, ride and walk steps, stations, time and fare (AC4.6.1)', () => {
    const result = planRoute(query(place('harvard-yard'), parseHHMM('10:00')), index);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { leg } = result;
    expect(leg.steps.map((s) => s.kind)).toEqual(['walk', 'wait', 'ride', 'walk']);
    expect(leg.steps[2]).toMatchObject({ line: 'red', toStationId: 'harvard', direction: 'toward Harvard' });
    expect(leg.fareUSD).toBe(2.4);
    expect(leg.durationMinutes).toBe(leg.steps.reduce((sum, s) => sum + s.minutes, 0));
    expect(result.arriveAt).toBe(parseHHMM('10:00') + leg.durationMinutes);
    expectConnected(leg);
  });

  it('changes lines with a transfer step when no single line connects the two places', () => {
    const fromHarvard = { ...query(place('revere-beach'), parseHHMM('11:00')), from: place('harvard-yard') };
    const result = planRoute(fromHarvard, index);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leg.steps.some((s) => s.kind === 'transfer')).toBe(true);
    expect(
      result.leg.steps
        .filter((s) => s.kind === 'ride')
        .map((s) => s.line)
        .at(-1),
    ).toBe('blue');
    expect(result.leg.fareUSD).toBe(2.4); // transfers are free
    expectConnected(result.leg);
  });

  it('walks directly between places that are close together', () => {
    const result = planRoute({ ...query(place('public-garden'), 600), from: place('boston-common') }, index);
    expect(result.ok && result.leg.mode).toBe('walk');
    if (result.ok) expect(result.leg.fareUSD).toBe(0);
  });

  it('never plans a walking step longer than the limit (AC4.6.2)', () => {
    for (const id of ['harvard-yard', 'mit-campus', 'revere-beach', 'boston-public-library']) {
      const result = planRoute(query(place(id), 600), index);
      expect(result.ok).toBe(true);
      if (result.ok)
        for (const step of result.leg.steps.filter((s) => s.kind === 'walk'))
          expect(step.minutes).toBeLessThanOrEqual(15);
    }
    const tight = planRoute(query(place('mit-campus', 3), 600, { maxWalkMinutes: 3 }), index);
    expect(tight).toEqual({ ok: false, reason: 'no-route' }); // MIT is an 8-minute walk from its station
  });

  it('gives the same leg when recomputed from the stored data alone (AC4.6.3)', () => {
    const first = planRoute(query(place('revere-beach'), 600), index);
    const again = planRoute(query(place('revere-beach'), 600), indexNetwork(structuredClone(data.network)));
    expect(again).toEqual(first);
    if (!first.ok) return;
    const ride = first.leg.steps.find((s) => s.kind === 'ride')!;
    const ridden = ['state', 'aquarium', 'maverick', 'airport', 'wonderland'];
    const edgeMinutes = data.network.edges
      .filter((e) => e.line === 'blue' && ridden.includes(e.from) && ridden.includes(e.to))
      .reduce((sum, e) => sum + e.minutes, 0);
    expect(ride.minutes).toBe(edgeMinutes);
  });
});

describe('service hours (FR5.2, AC4.7.1)', () => {
  const lateRed = sampleDataWith((files) => {
    line(files, 'red').lastTrain = '21:00';
  });
  const lateIndex = indexNetwork(lateRed.network);
  const harvard = placeLocation(lateRed.placeById.get('harvard-yard')!, lateRed.network, 15);

  it('refuses a ride after the last train and says so', () => {
    expect(planRoute(query(harvard, parseHHMM('21:30')), lateIndex)).toEqual({
      ok: false,
      reason: 'outside-service-hours',
    });
    expect(planRoute(query(harvard, parseHHMM('20:30')), lateIndex).ok).toBe(true);
  });

  it('waits for the first train instead of riding before it', () => {
    const result = planRoute(query(harvard, parseHHMM('04:30')), lateIndex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const wait = result.leg.steps.find((s) => s.kind === 'wait')!;
    const walk = result.leg.steps[0]!;
    expect(parseHHMM('04:30') + walk.minutes + wait.minutes).toBeGreaterThanOrEqual(parseHHMM('05:15'));
  });

  it('reads per-weekday hours and last trains past midnight', () => {
    const blue = data.lineById.get('blue') as Line;
    expect(serviceWindow(blue, 'thu')).toEqual({ first: parseHHMM('05:15'), last: 24 * 60 + 30 });
    expect(serviceWindow(blue, 'sun').first).toBe(parseHHMM('06:00'));
    expect(boardingTime(blue, 'sun', parseHHMM('05:00'))).toBe(parseHHMM('06:00') + 5); // half the 9-min off-peak headway
    expect(boardingTime(blue, 'thu', 24 * 60 + 29)).toBeUndefined();
  });

  it('uses peak, off-peak and evening headways by time and weekday', () => {
    const blue = data.lineById.get('blue') as Line;
    expect(headwayAt(blue, 'thu', parseHHMM('08:00'))).toBe(5);
    expect(headwayAt(blue, 'sat', parseHHMM('08:00'))).toBe(9);
    expect(headwayAt(blue, 'thu', parseHHMM('12:00'))).toBe(9);
    expect(headwayAt(blue, 'thu', parseHHMM('21:00'))).toBe(12);
  });
});
