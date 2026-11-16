import { describe, expect, it } from 'vitest';
import { loadBostonData } from '../src/lib/data.js';
import { walkMinutesBetween } from '../src/lib/geo.js';
import { DEFAULT_PREFERENCES, defaultTitle, validateTripRequest } from '../src/lib/schemas.js';
import { DOWNTOWN_HOTEL, TEST_NOW, validRequestBody } from './fixtures/requests.js';

const context = { now: TEST_NOW, data: loadBostonData() };
const validate = (body: unknown) => validateTripRequest(body, context);

function fieldsOf(body: unknown): string[] {
  const result = validate(body);
  return result.ok ? [] : result.fields.map((f) => f.field);
}

describe('validateTripRequest: accepted requests', () => {
  it('accepts a valid request and keeps it as sent (AC2.1.2)', () => {
    const body = validRequestBody();
    const result = validate(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject(body);
    expect(result.value.hotel.nearestStationId).toBe('state');
  });

  it('fills documented defaults when optional fields are left out (AC2.1.3)', () => {
    const body = validRequestBody();
    delete body.title;
    delete body.notes;
    delete body.preferences;
    const result = validate(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(result.value.title).toBeUndefined();
    expect(result.value.notes).toBeUndefined();
    expect(defaultTitle(result.value)).toBe('Boston trip 2026-11-18 to 2026-11-21');
  });

  it('uses the walk to the station the traveler named when no walk time is given', () => {
    const hotel = { ...DOWNTOWN_HOTEL, nearestStationId: 'aquarium' };
    const result = validate(validRequestBody({ hotel }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const aquarium = context.data.stationById.get('aquarium')!;
    const expected = walkMinutesBetween(DOWNTOWN_HOTEL, aquarium);
    expect(result.value.hotel).toMatchObject({ nearestStationId: 'aquarium', walkMinutesToStation: expected });
    expect(expected).toBeGreaterThan(walkMinutesBetween(DOWNTOWN_HOTEL, context.data.stationById.get('state')!));
  });

  it('keeps a walk time the traveler gave, and uses the nearest station when none is named', () => {
    const given = validate(
      validRequestBody({ hotel: { ...DOWNTOWN_HOTEL, nearestStationId: 'aquarium', walkMinutesToStation: 12 } }),
    );
    expect(given.ok && given.value.hotel.walkMinutesToStation).toBe(12);
    const unnamed = validate(validRequestBody());
    expect(unnamed.ok && unnamed.value.hotel).toMatchObject({
      nearestStationId: 'state',
      walkMinutesToStation: walkMinutesBetween(DOWNTOWN_HOTEL, context.data.stationById.get('state')!),
    });
  });

  it('accepts every limit at its value: 7 days, 6 travelers, 15 places, 12 months ahead (AC2.2.1)', () => {
    const body = validRequestBody({
      arrival: '2027-10-23T10:00',
      departure: '2027-10-29T15:00',
      travelers: 6,
      wishlist: Array.from({ length: 15 }, (_, i) => `place ${i}`.padEnd(100, 'x')),
      notes: 'n'.repeat(1000),
    });
    expect(fieldsOf(body)).toEqual([]);
  });
});

describe('validateTripRequest: refused requests (AC2.2.2)', () => {
  it.each([
    ['8 days', { departure: '2026-11-25T15:00' }, 'departure'],
    ['7 travelers', { travelers: 7 }, 'travelers'],
    ['16 places', { wishlist: Array.from({ length: 16 }, (_, i) => `place ${i}`) }, 'wishlist'],
    ['a past arrival', { arrival: '2026-10-23T11:59', departure: '2026-10-25T10:00' }, 'arrival'],
    ['12 months and 1 day ahead', { arrival: '2027-10-24T10:00', departure: '2027-10-25T10:00' }, 'arrival'],
    ['departure before arrival', { departure: '2026-11-18T09:00' }, 'departure'],
  ])('refuses %s', (_label, overrides, field) => {
    expect(fieldsOf(validRequestBody(overrides))).toEqual([field]);
  });

  it('names both fields when two are invalid, with a reason for each (AC2.2.3)', () => {
    const result = validate(validRequestBody({ travelers: 0, departure: '2026-11-17T10:00' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields).toEqual([
      { field: 'travelers', message: 'must be at least 1' },
      { field: 'departure', message: 'must be after arrival' },
    ]);
  });

  it('refuses a hotel more than a 30-minute walk from every station (AC2.2.4)', () => {
    const body = validRequestBody({
      hotel: { name: 'Far Hotel', address: 'Wellesley, MA', lat: 42.2965, lng: -71.2924 },
    });
    const result = validate(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields[0]?.field).toBe('hotel');
    expect(result.fields[0]?.message).toMatch(/outside the area the planner covers/);
  });

  it('refuses unknown fields, missing fields and over-long text', () => {
    const body = validRequestBody({ unexpected: true, wishlist: ['x'.repeat(101)], notes: 'n'.repeat(1001) });
    delete body.travelers;
    expect(fieldsOf(body).sort()).toEqual(['notes', 'travelers', 'unexpected', 'wishlist.0']);
    const result = validate(body);
    if (!result.ok) expect(result.fields.find((f) => f.field === 'travelers')?.message).toBe('is required');
  });

  it('refuses a back-at-hotel time before the day start and an unknown hotel station', () => {
    const body = validRequestBody({
      preferences: { dayStart: '20:00', dayEnd: '09:00' },
      hotel: { name: 'H', address: 'A', lat: 42.3586, lng: -71.0585, nearestStationId: 'atlantis' },
    });
    expect(fieldsOf(body).sort()).toEqual(['hotel.nearestStationId', 'preferences.dayEnd']);
  });

  it('refuses a body that is not an object', () => {
    expect(fieldsOf('hello')).toEqual(['(body)']);
    expect(fieldsOf(null)).toEqual(['(body)']);
  });
});
