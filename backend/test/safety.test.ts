import { UNKNOWN_SAFETY_AREA_ID, type SafetyArea, type TransitLeg } from '@jarvel/shared';
import { describe, expect, it } from 'vitest';
import { loadBostonData } from '../src/lib/data.js';
import { areaAtPoint, checkAreaAtTime, checkLegSafety, stationAreaId, type SafetyContext } from '../src/lib/safety.js';
import { parseHHMM } from '../src/lib/time.js';
import { area, sampleDataWith } from './fixtures/data.js';

const SUNSET = parseHHMM('16:20');

function testArea(overrides: Partial<SafetyArea>): SafetyArea {
  return {
    id: 'test-area',
    name: 'Test Area',
    center: { lat: 42.36, lng: -71.06 },
    radiusKm: 1,
    bpdDistricts: [],
    dayRisk: 'low',
    nightRisk: 'low',
    notes: 'Test notes',
    ...overrides,
  };
}

function context(areaDef: SafetyArea, strictness: 'standard' | 'strict' = 'standard'): SafetyContext {
  return { areaById: new Map([[areaDef.id, areaDef]]), sunset: SUNSET, strictness };
}

const at = (from: string, to: string) => [parseHHMM(from), parseHHMM(to)] as const;

describe('checkAreaAtTime (FR4)', () => {
  it('refuses any item ending after the area’s avoid-after time (AC4.3.1)', () => {
    const ctx = context(testArea({ avoidAfter: '15:00' }));
    expect(checkAreaAtTime('test-area', ...at('13:00', '14:50'), ctx).allowed).toBe(true);
    expect(checkAreaAtTime('test-area', ...at('14:30', '15:10'), ctx)).toMatchObject({
      allowed: false,
      rule: 'avoid-after',
    });
  });

  it('refuses an area with high night risk after sunset, but not before (AC4.3.2)', () => {
    const ctx = context(testArea({ nightRisk: 'elevated' }));
    expect(checkAreaAtTime('test-area', ...at('15:00', '16:20'), ctx)).toMatchObject({ allowed: true, level: 'low' });
    expect(checkAreaAtTime('test-area', ...at('16:00', '16:30'), ctx)).toMatchObject({
      allowed: false,
      rule: 'elevated-after-dark',
    });
  });

  it('refuses a moderate night-risk area after sunset only under strict safety (AC4.3.3)', () => {
    const moderate = testArea({ nightRisk: 'moderate' });
    expect(checkAreaAtTime('test-area', ...at('18:00', '19:00'), context(moderate))).toMatchObject({
      allowed: true,
      level: 'moderate',
    });
    expect(checkAreaAtTime('test-area', ...at('18:00', '19:00'), context(moderate, 'strict'))).toMatchObject({
      allowed: false,
      rule: 'moderate-after-dark-strict',
    });
  });

  it('allows a place with no safety information only before sunset (AC4.3.4, FR4.5)', () => {
    const ctx = context(testArea({}));
    for (const id of [UNKNOWN_SAFETY_AREA_ID, 'not-an-area', undefined]) {
      expect(checkAreaAtTime(id, ...at('10:00', '11:00'), ctx)).toMatchObject({ allowed: true, known: false });
      expect(checkAreaAtTime(id, ...at('16:00', '16:40'), ctx)).toMatchObject({
        allowed: false,
        rule: 'unknown-after-dark',
      });
    }
  });
});

describe('checkLegSafety (AC4.3.5)', () => {
  const data = sampleDataWith((files) => {
    area(files, 'revere-beach').nightRisk = 'elevated';
  });
  const ctx: SafetyContext = { areaById: data.areaById, sunset: SUNSET, strictness: 'standard' };
  const leg: TransitLeg = {
    mode: 'subway',
    fromLabel: 'Hotel',
    toLabel: 'Revere Beach',
    fareUSD: 2.4,
    durationMinutes: 30,
    steps: [
      { kind: 'walk', toStationId: 'state', minutes: 2, instruction: 'walk' },
      { kind: 'wait', line: 'blue', fromStationId: 'state', minutes: 5, instruction: 'wait' },
      {
        kind: 'ride',
        line: 'blue',
        fromStationId: 'state',
        toStationId: 'wonderland',
        minutes: 17,
        instruction: 'ride',
      },
      { kind: 'walk', fromStationId: 'wonderland', minutes: 6, instruction: 'walk' },
    ],
  };
  const ends = { fromAreaId: 'government-center', toAreaId: 'revere-beach' };

  it('checks walks and station waits, so arriving in a high-risk area after dark is refused', () => {
    expect(checkLegSafety(leg, parseHHMM('15:00'), ends, data, ctx).allowed).toBe(true);
    expect(checkLegSafety(leg, parseHHMM('16:00'), ends, data, ctx)).toMatchObject({
      allowed: false,
      rule: 'elevated-after-dark',
    });
  });

  it('does not check the time spent inside the train', () => {
    const rideOnly: TransitLeg = { ...leg, steps: [leg.steps[2]!], durationMinutes: 17 };
    expect(checkLegSafety(rideOnly, parseHHMM('20:00'), ends, data, ctx).allowed).toBe(true);
  });

  it('finds the safety area of stations and points', () => {
    expect(stationAreaId('state', data)).toBe('government-center');
    expect(stationAreaId('no-such-station', data)).toBeUndefined();
    expect(areaAtPoint({ lat: 42.2965, lng: -71.2924 }, loadBostonData())).toBeUndefined();
  });
});
