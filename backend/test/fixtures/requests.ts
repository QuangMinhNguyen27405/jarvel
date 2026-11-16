// Shared TripRequest builders. The base request is the requester's own 4-day trip: Nov 18 10:00 to Nov 21 15:00.
import type { TripRequest } from '@jarvel/shared';

/** "Now" for validation tests: 2026-10-23 12:00 Boston time (16:00 UTC, EDT). */
export const TEST_NOW = new Date('2026-10-23T16:00:00Z');

/** A hotel next to State station, inside the covered area. */
export const DOWNTOWN_HOTEL = {
  name: 'Sample Hotel Downtown',
  address: 'Sample address near State Street, Boston (test fixture)',
  lat: 42.3586,
  lng: -71.0585,
};

/** A request body as a traveler would send it (no defaults filled in). */
export function validRequestBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'My Boston trip',
    arrival: '2026-11-18T10:00',
    departure: '2026-11-21T15:00',
    travelers: 2,
    hotel: { ...DOWNTOWN_HOTEL },
    wishlist: ['Boston Public Library', 'New England Aquarium', 'Harvard Yard'],
    notes: 'We like quiet places.',
    preferences: {
      pace: 'moderate',
      safety: 'standard',
      budgetLevel: 'moderate',
      transport: 'subway-first',
      maxWalkMinutes: 15,
      dayStart: '09:00',
      dayEnd: '21:30',
      includeMichelin: false,
    },
    ...overrides,
  };
}

/** A fully-defaulted TripRequest, as stored after validation. */
export function validTripRequest(overrides: Partial<TripRequest> = {}): TripRequest {
  const body = validRequestBody() as unknown as TripRequest;
  return {
    ...body,
    hotel: { ...DOWNTOWN_HOTEL, nearestStationId: 'state', walkMinutesToStation: 1 },
    ...overrides,
  };
}
