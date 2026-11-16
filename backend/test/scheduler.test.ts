import type { Itinerary, ItineraryItem, TripRequest } from '@jarvel/shared';
import { describe, expect, it } from 'vitest';
import type { AiSelection } from '../src/lib/ai.js';
import { loadBostonData, type BostonData } from '../src/lib/data.js';
import { isOpenFor } from '../src/lib/hours.js';
import { renderPlanMarkdown } from '../src/lib/markdown.js';
import {
  buildItinerary,
  DISCLAIMER,
  LATE_START_TOLERANCE_MINUTES,
  MAX_WAIT_FOR_OPENING_MINUTES,
  NoSafePlanError,
  UNSCHEDULED_REASONS,
} from '../src/lib/scheduler.js';
import { sunsetHHMM } from '../src/lib/sun.js';
import { formatHHMM, listDates, parseHHMM } from '../src/lib/time.js';
import { validateItinerary } from '../src/lib/validator.js';
import { area, hoursOf, line, sampleDataWith } from './fixtures/data.js';
import { baseSelection } from './fixtures/fake-ai.js';
import { queuedPlan } from './fixtures/plans.js';
import { validTripRequest } from './fixtures/requests.js';

const sample = loadBostonData();

function plan(selection: AiSelection, request: TripRequest = validTripRequest(), data: BostonData = sample): Itinerary {
  return buildItinerary({ request, data, selection, modelId: 'test-model', generatedAt: '2026-10-23T16:00:00Z' });
}

const stops = (itinerary: Itinerary): ItineraryItem[] =>
  itinerary.days.flatMap((day) => day.items.filter((i) => i.placeId));
const minutes = (hhmm: string) => parseHHMM(hhmm);

describe('the day-by-day timeline (US4.1)', () => {
  const itinerary = plan(baseSelection());
  const request = validTripRequest();

  it('has exactly 4 days for Nov 18 10:00 to Nov 21 15:00, with no overlaps or rule breaks (AC4.1.1)', () => {
    expect(itinerary.days.map((d) => d.date)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
    expect(validateItinerary(itinerary, request, sample)).toEqual([]);
  });

  it('starts day 1 with the arrival and the trip to the hotel before any stop (AC4.1.2)', () => {
    const [airport, toHotel, checkIn, ...rest] = itinerary.days[0]!.items;
    expect(airport).toMatchObject({ kind: 'airport', start: '10:00' });
    expect(toHotel?.kind).toBe('transit');
    expect(checkIn?.kind).toBe('hotel');
    expect(rest.every((item) => item.start >= checkIn!.end)).toBe(true);
  });

  it('joins transit steps into one sentence each, with no doubled full stops (seen in the Nov 12 browser run)', () => {
    const transit = itinerary.days.flatMap((day) => day.items.filter((item) => item.kind === 'transit'));
    const fromAirport = itinerary.days[0]!.items[1]!;
    expect(fromAirport.description).toContain('(sample estimate: about 10 min). Wait about');
    expect(transit.length).toBeGreaterThan(0);
    for (const item of transit) expect(item.description).not.toMatch(/\.\./);
  });

  it('ends the last day at the airport before departure (AC4.1.3)', () => {
    const last = itinerary.days[3]!.items.at(-1)!;
    expect(last).toMatchObject({ kind: 'airport', end: '15:00' });
    expect(itinerary.days[3]!.items.every((item) => item.end <= '15:00')).toBe(true);
  });

  it('keeps every other day between 09:00 and 21:30 and back at the hotel (AC4.1.4)', () => {
    for (const day of itinerary.days.slice(1, 3)) {
      expect(day.items[0]!.start >= '09:00').toBe(true);
      expect(day.items.at(-1)).toMatchObject({ kind: 'hotel' });
      expect(day.items.at(-1)!.start <= '21:30').toBe(true);
    }
  });

  it('shows correct local dates, weekdays and sunsets across the DST change (AC4.1.5)', () => {
    const request = validTripRequest({ arrival: '2026-10-31T10:00', departure: '2026-11-02T15:00' });
    const dst = plan({ days: [{ date: '2026-11-01', placeIds: ['harvard-yard'] }] }, request);
    expect(dst.days.map((d) => `${d.date}:${d.weekday}`)).toEqual([
      '2026-10-31:sat',
      '2026-11-01:sun',
      '2026-11-02:mon',
    ]);
    expect(dst.days[0]!.safetyGuidance[0]).toContain(sunsetHHMM('2026-10-31'));
    expect(dst.days[1]!.safetyGuidance[0]).toContain(sunsetHHMM('2026-11-01'));
    expect(sunsetHHMM('2026-10-31') > sunsetHHMM('2026-11-01')).toBe(true);
    for (const item of dst.days.flatMap((d) => d.items)) expect(item.start).toMatch(/^\d{2}:\d{2}$/);
    expect(validateItinerary(dst, request, sample)).toEqual([]);
  });
});

describe('wishlist coverage (US4.2)', () => {
  it('lists every entry once: scheduled, or unscheduled with a reason (AC4.2.1, AC4.2.2)', () => {
    const request = validTripRequest({
      wishlist: ['Boston Public Library', 'Tatte Bakery', 'Harvard Yard', 'harvard yard'],
    });
    const itinerary = plan(baseSelection(), request);
    expect(itinerary.unscheduled).toEqual([
      { name: 'Tatte Bakery', reason: UNSCHEDULED_REASONS.notInData },
      { placeId: 'harvard-yard', name: 'harvard yard', reason: UNSCHEDULED_REASONS.duplicate },
    ]);
    expect(validateItinerary(itinerary, request, sample)).toEqual([]);
  });

  it('still schedules a wishlist place the AI left out', () => {
    const itinerary = plan({ days: [{ date: '2026-11-19', placeIds: ['new-england-aquarium'] }] });
    const scheduled = stops(itinerary).map((s) => s.placeId);
    expect(scheduled).toEqual(
      expect.arrayContaining(['boston-public-library', 'new-england-aquarium', 'harvard-yard']),
    );
    expect(stops(itinerary).filter((s) => s.isWishlist)).toHaveLength(3);
  });

  it('schedules only places from the Boston data (AC4.2.3)', () => {
    for (const stop of stops(plan(baseSelection()))) expect(sample.placeById.has(stop.placeId!)).toBe(true);
  });
});

describe('safety and the last train (US4.3, US4.4, US4.7)', () => {
  describe('a Chinatown dinner the AI put after dark (moderate night risk in the sample data)', () => {
    // A 6-hour aquarium visit pushes the meal past the Nov 19 sunset (about 16:20).
    const data = sampleDataWith((files) => {
      files.places.places.find((p) => p.id === 'new-england-aquarium')!.typicalDwellMinutes = 360;
    });
    const selection = {
      days: [{ date: '2026-11-19', placeIds: ['new-england-aquarium', 'harvard-yard', 'sample-pho-house-chinatown'] }],
    };
    const prefs = validTripRequest().preferences;
    const wishlist = ['New England Aquarium', 'Harvard Yard', 'Sample Pho House'];
    const dayOf = (itinerary: Itinerary, placeId: string) =>
      itinerary.days.find((d) => d.items.some((i) => i.placeId === placeId));

    it('stays after dark under standard safety', () => {
      const request = validTripRequest({ wishlist, preferences: { ...prefs, safety: 'standard' } });
      const itinerary = plan(selection, request, data);
      const pho = stops(itinerary).find((s) => s.placeId === 'sample-pho-house-chinatown')!;
      expect(dayOf(itinerary, pho.placeId!)?.date).toBe('2026-11-19');
      expect(minutes(pho.start)).toBeGreaterThan(minutes(sunsetHHMM('2026-11-19')));
      expect(validateItinerary(itinerary, request, data)).toEqual([]);
    });

    it('is moved into daylight on another day under strict safety (AC4.3.3)', () => {
      const request = validTripRequest({ wishlist, preferences: { ...prefs, safety: 'strict' } });
      const itinerary = plan(selection, request, data);
      const pho = stops(itinerary).find((s) => s.placeId === 'sample-pho-house-chinatown')!;
      const date = dayOf(itinerary, pho.placeId!)!.date;
      expect(date).not.toBe('2026-11-19');
      expect(minutes(pho.end)).toBeLessThanOrEqual(minutes(sunsetHHMM(date)));
      expect(itinerary.unscheduled).toEqual([]);
      expect(validateItinerary(itinerary, request, data)).toEqual([]);
    });
  });

  it('lists a stop that is unsafe at every possible time as "unsafe at the only possible time" (AC4.4.2)', () => {
    const data = sampleDataWith((files) => {
      area(files, 'revere-beach').avoidAfter = '08:00';
    });
    const request = validTripRequest({ wishlist: ['Revere Beach'] });
    const itinerary = plan({ days: [{ date: '2026-11-19', placeIds: ['revere-beach'] }] }, request, data);
    expect(itinerary.unscheduled).toEqual([
      { placeId: 'revere-beach', name: 'Revere Beach', reason: UNSCHEDULED_REASONS.unsafe },
    ]);
    expect(validateItinerary(itinerary, request, data)).toEqual([]);
  });

  it('rearranges a day so the last stop does not miss the last train (AC4.7.2)', () => {
    const data = sampleDataWith((files) => {
      line(files, 'red').lastTrain = '11:00';
    });
    const request = validTripRequest({ wishlist: ['New England Aquarium', 'Harvard Yard'] });
    const itinerary = plan(
      { days: [{ date: '2026-11-19', placeIds: ['new-england-aquarium', 'harvard-yard'] }] },
      request,
      data,
    );
    const harvard = stops(itinerary).find((s) => s.placeId === 'harvard-yard');
    expect(harvard).toBeDefined();
    expect(minutes(harvard!.end)).toBeLessThan(minutes('11:00'));
    expect(validateItinerary(itinerary, request, data)).toEqual([]); // no ride outside service hours (AC4.7.3)
  });

  it('unschedules a stop that would miss the last train on every day (AC4.7.2, AC4.7.3)', () => {
    const data = sampleDataWith((files) => {
      line(files, 'red').lastTrain = '09:05';
    });
    const request = validTripRequest({ wishlist: ['Harvard Yard'] });
    const itinerary = plan({ days: [{ date: '2026-11-20', placeIds: ['harvard-yard'] }] }, request, data);
    expect(itinerary.unscheduled).toEqual([
      { placeId: 'harvard-yard', name: 'Harvard Yard', reason: UNSCHEDULED_REASONS.lastTrain },
    ]);
    expect(validateItinerary(itinerary, request, data)).toEqual([]);
  });

  it('fails the whole plan when the traveler cannot even reach the hotel from the airport', () => {
    const data = sampleDataWith((files) => {
      line(files, 'blue').lastTrain = '05:20';
    });
    expect(() => plan(baseSelection(), validTripRequest(), data)).toThrow(NoSafePlanError);
  });
});

describe('guidance, disclaimer and departure (US4.5)', () => {
  it('gives each day safety guidance and the plan a guidance-not-guarantee disclaimer (AC4.5.1, AC4.5.2)', () => {
    const itinerary = plan(baseSelection());
    for (const day of itinerary.days) expect(day.safetyGuidance.length).toBeGreaterThan(0);
    expect(itinerary.disclaimer).toContain(DISCLAIMER);
    expect(itinerary.disclaimer).toContain('SAMPLE data'); // the bundled data is not hand-checked
  });

  it('leaves for an early flight as late as still reaches the airport in time', () => {
    const request = validTripRequest({ departure: '2026-11-21T08:00' });
    const itinerary = plan(baseSelection(), request);
    const last = itinerary.days.at(-1)!;
    const toAirport = last.items.filter((i) => i.kind === 'transit').at(-1)!;
    expect(minutes(toAirport.end)).toBeLessThanOrEqual(minutes('06:30'));
    expect(minutes(toAirport.end)).toBeGreaterThan(minutes('06:00'));
    expect(validateItinerary(itinerary, request, sample)).toEqual([]);
  });
});

describe('locations for the trip map (Nov 3 request)', () => {
  const request = validTripRequest();
  const itinerary = plan(baseSelection(), request);
  const items = itinerary.days.flatMap((day) => day.items);

  it('places every visit and meal at its stored coordinates', () => {
    const placed = items.filter((item) => item.kind === 'visit' || item.kind === 'meal');
    expect(placed.length).toBeGreaterThan(0);
    for (const item of placed) {
      const place = sample.placeById.get(item.placeId!)!;
      expect(item.location).toEqual({ lat: place.lat, lng: place.lng });
    }
  });

  it('places every hotel item at the trip hotel', () => {
    const hotels = items.filter((item) => item.kind === 'hotel');
    expect(hotels.length).toBeGreaterThan(0);
    for (const item of hotels) expect(item.location).toEqual({ lat: request.hotel.lat, lng: request.hotel.lng });
  });

  it('gives transit and airport items no single location', () => {
    const moving = items.filter((item) => item.kind === 'transit' || item.kind === 'airport');
    expect(moving.length).toBeGreaterThan(0);
    for (const item of moving) expect(item.location).toBeUndefined();
  });

  it('leaves the Markdown output unchanged by the new field', () => {
    const withoutLocations: Itinerary = {
      ...itinerary,
      days: itinerary.days.map((day) => ({
        ...day,
        items: day.items.map((item) => {
          const copy = { ...item };
          delete copy.location;
          return copy;
        }),
      })),
    };
    const record = (i: Itinerary) => queuedPlan({ request, status: 'SUCCEEDED', itinerary: i });
    expect(renderPlanMarkdown(record(itinerary))).toBe(renderPlanMarkdown(record(withoutLocations)));
  });
});

describe('stops inside opening hours (US7.3, FR12)', () => {
  // Nov 19 2026 is a Thursday and Nov 20 a Friday. Made-up hours are put on the sample places; the hours of the
  // real businesses from the traveler's list are left alone.
  const THURSDAY = '2026-11-19';
  const FRIDAY = '2026-11-20';
  const oneDay = (date: string, placeIds: string[]): AiSelection => ({ days: [{ date, placeIds }] });
  /** One day's items as "start-end what", where "what" is the place id or, for other items, the kind. */
  const timeline = (itinerary: Itinerary, date: string): string[] =>
    itinerary.days.find((d) => d.date === date)!.items.map((i) => `${i.start}-${i.end} ${i.placeId ?? i.kind}`);
  const noWishlist = validTripRequest({ wishlist: [] });

  it('leaves the hotel later for a place that is not open yet, so the visit starts as it opens (AC7.3.1)', () => {
    const data = sampleDataWith((files) => {
      hoursOf(files, 'sample-bakery-back-bay').thu = [['11:00', '19:00']];
    });
    const request = validTripRequest({ wishlist: ['Sample Bakery'] });
    const itinerary = plan(oneDay(THURSDAY, ['sample-bakery-back-bay']), request, data);
    // Leaving at 09:00 would reach the door at 09:14. The leg leaves at 10:46 instead; trains are a little less
    // frequent after the morning peak, so it arrives one minute after opening.
    expect(timeline(itinerary, THURSDAY)).toEqual([
      '10:46-11:01 transit',
      '11:01-11:31 sample-bakery-back-bay',
      '11:31-11:46 transit',
      '11:46-11:46 hotel',
    ]);
    expect(validateItinerary(itinerary, request, data)).toEqual([]);
  });

  it('visits a dinner-only place after an open one, although the AI listed it first', () => {
    const data = sampleDataWith((files) => {
      hoursOf(files, 'sample-pho-house-chinatown').fri = [['17:30', '22:00']];
    });
    const itinerary = plan(oneDay(FRIDAY, ['sample-pho-house-chinatown', 'new-england-aquarium']), noWishlist, data);
    expect(timeline(itinerary, FRIDAY)).toEqual([
      '09:00-09:09 transit',
      '09:09-11:09 new-england-aquarium',
      '17:09-17:28 transit', // the free afternoon is before this leg, not at the restaurant's door
      '17:30-18:30 sample-pho-house-chinatown',
      '18:30-18:42 transit',
      '18:42-18:42 hotel',
    ]);
    expect(validateItinerary(itinerary, noWishlist, data)).toEqual([]);
  });

  it('keeps the AI’s order for a wait of up to 30 minutes and changes it for a longer one', () => {
    // Leaving the hotel at 09:00, the traveler reaches the library at 09:11 at the earliest.
    const opening = (minutesAfterArrival: number) => formatHHMM(parseHHMM('09:11') + minutesAfterArrival);
    const order = ['boston-public-library', 'boston-common'];
    const withOpening = (open: string) =>
      sampleDataWith((files) => {
        hoursOf(files, 'boston-public-library').thu = [[open, '20:00']];
      });

    const shortWait = withOpening(opening(MAX_WAIT_FOR_OPENING_MINUTES));
    expect(timeline(plan(oneDay(THURSDAY, order), noWishlist, shortWait), THURSDAY)).toEqual([
      '09:30-09:42 transit',
      '09:42-10:42 boston-public-library',
      '10:42-10:52 transit',
      '10:52-11:37 boston-common',
      '11:37-11:47 transit',
      '11:47-11:47 hotel',
    ]);

    const longWait = withOpening(opening(MAX_WAIT_FOR_OPENING_MINUTES + 1));
    expect(timeline(plan(oneDay(THURSDAY, order), noWishlist, longWait), THURSDAY)).toEqual([
      '09:00-09:09 transit',
      '09:09-09:54 boston-common',
      '09:54-10:04 transit',
      '10:04-11:04 boston-public-library',
      '11:04-11:16 transit',
      '11:16-11:16 hotel',
    ]);
  });

  it('tries a stop again after each later stop and returns to the AI’s order as soon as it can', () => {
    const data = sampleDataWith((files) => {
      hoursOf(files, 'sample-pho-house-chinatown').thu = [['10:30', '22:00']];
    });
    const order = ['sample-pho-house-chinatown', 'boston-common', 'public-garden'];
    const itinerary = plan(oneDay(THURSDAY, order), noWishlist, data);
    // At 09:00 the pho house is 78 minutes from opening, so Boston Common goes first; after it the pho house is
    // 26 minutes from opening, so it is next, ahead of the Public Garden, as the AI ordered.
    expect(stops(itinerary).map((stop) => `${stop.placeId}@${stop.start}`)).toEqual([
      'boston-common@09:09',
      'sample-pho-house-chinatown@10:30',
      'public-garden@11:43',
    ]);
    expect(validateItinerary(itinerary, noWishlist, data)).toEqual([]);
  });

  it('waits at the door when leaving later would break a safety rule', () => {
    const data = sampleDataWith((files) => {
      area(files, 'revere-beach').avoidAfter = '11:00';
      hoursOf(files, 'sample-bakery-back-bay').thu = [['14:00', '19:00']];
    });
    const request = validTripRequest({ wishlist: ['Revere Beach', 'Sample Bakery'] });
    const itinerary = plan(oneDay(THURSDAY, ['revere-beach', 'sample-bakery-back-bay']), request, data);
    // Staying at the beach until about 13:15 is not allowed after 11:00, so the traveler leaves at once and waits.
    expect(timeline(itinerary, THURSDAY)).toEqual([
      '09:00-09:26 transit',
      '09:26-10:11 revere-beach',
      '10:11-10:55 transit',
      '14:00-14:30 sample-bakery-back-bay',
      '14:30-14:45 transit',
      '14:45-14:45 hotel',
    ]);
    expect(validateItinerary(itinerary, request, data)).toEqual([]);
  });

  it('waits at the door when the later leg would arrive more than 15 minutes after opening', () => {
    const request = validTripRequest({ wishlist: ['Harvard Yard'] });
    const opensAtTen = (files: Parameters<typeof hoursOf>[0]) => {
      hoursOf(files, 'harvard-yard').thu = [['10:00', '21:00']];
    };
    const normal = sampleDataWith(opensAtTen);
    const [leg, visit] = timeline(plan(oneDay(THURSDAY, ['harvard-yard']), request, normal), THURSDAY);
    expect([leg, visit]).toEqual(['09:38-10:02 transit', '10:02-11:02 harvard-yard']);
    expect(minutes('10:02') - minutes('10:00')).toBeLessThanOrEqual(LATE_START_TOLERANCE_MINUTES);

    // With an hourly Red Line outside the morning peak, leaving at 09:38 would arrive long after 10:00.
    const slow = sampleDataWith((files) => {
      opensAtTen(files);
      line(files, 'red').headwayMinutes = { peak: 6, offPeak: 60, evening: 60 };
    });
    const itinerary = plan(oneDay(THURSDAY, ['harvard-yard']), request, slow);
    expect(timeline(itinerary, THURSDAY).slice(0, 2)).toEqual(['09:00-09:22 transit', '10:00-11:00 harvard-yard']);
    expect(validateItinerary(itinerary, request, slow)).toEqual([]);
  });

  it('uses a later opening period when the visit does not fit in the first one', () => {
    const data = sampleDataWith((files) => {
      hoursOf(files, 'sample-pho-house-chinatown').thu = [
        ['11:00', '11:30'],
        ['12:30', '14:00'],
      ];
    });
    const itinerary = plan(oneDay(THURSDAY, ['new-england-aquarium', 'sample-pho-house-chinatown']), noWishlist, data);
    expect(timeline(itinerary, THURSDAY).slice(1, 4)).toEqual([
      '09:09-11:09 new-england-aquarium',
      '12:09-12:30 transit',
      '12:30-13:30 sample-pho-house-chinatown',
    ]);
  });

  it('limits nothing on a weekday whose hours are unknown', () => {
    const data = sampleDataWith((files) => {
      delete hoursOf(files, 'sample-bakery-back-bay').thu;
    });
    const itinerary = plan(oneDay(THURSDAY, ['sample-bakery-back-bay']), noWishlist, data);
    expect(timeline(itinerary, THURSDAY).slice(0, 2)).toEqual([
      '09:00-09:14 transit',
      '09:14-09:44 sample-bakery-back-bay',
    ]);
    expect(validateItinerary(itinerary, noWishlist, data)).toEqual([]);
  });

  it('moves a stop that is closed on the AI’s date to a day it is open', () => {
    const data = sampleDataWith((files) => {
      hoursOf(files, 'harvard-yard').thu = [];
    });
    const request = validTripRequest({ wishlist: ['Harvard Yard'] });
    const itinerary = plan(oneDay(THURSDAY, ['harvard-yard']), request, data);
    expect(stops(itinerary).map((stop) => stop.placeId)).toEqual(['harvard-yard']);
    expect(timeline(itinerary, '2026-11-18')).toContain('11:48-12:48 harvard-yard');
    expect(timeline(itinerary, THURSDAY)).toEqual(['09:00-09:00 hotel']);
    expect(itinerary.unscheduled).toEqual([]);
    expect(validateItinerary(itinerary, request, data)).toEqual([]);
  });

  it('leaves out a closed stop that is not on the wishlist without listing it', () => {
    const data = sampleDataWith((files) => {
      hoursOf(files, 'harvard-yard').thu = [];
    });
    const itinerary = plan(oneDay(THURSDAY, ['harvard-yard', 'boston-common']), noWishlist, data);
    expect(stops(itinerary).map((stop) => stop.placeId)).toEqual(['boston-common']);
    expect(itinerary.unscheduled).toEqual([]);
  });

  it('lists a place closed on every trip date as "closed on your dates", chosen by the AI or not (AC7.3.2)', () => {
    const data = sampleDataWith((files) => {
      for (const id of ['harvard-yard', 'revere-beach']) {
        Object.assign(hoursOf(files, id), { wed: [], thu: [], fri: [], sat: [] });
      }
    });
    const request = validTripRequest({ wishlist: ['Harvard Yard', 'Revere Beach'] });
    const itinerary = plan(oneDay(THURSDAY, ['harvard-yard']), request, data); // the AI left Revere Beach out
    expect(itinerary.unscheduled).toEqual([
      { placeId: 'harvard-yard', name: 'Harvard Yard', reason: 'closed on your dates' },
      { placeId: 'revere-beach', name: 'Revere Beach', reason: UNSCHEDULED_REASONS.closed },
    ]);
    expect(stops(itinerary)).toEqual([]);
    expect(validateItinerary(itinerary, request, data)).toEqual([]);
  });

  it('says "does not fit in your days" of a place that is open on some trip date but cannot be placed then', () => {
    // Closed until Saturday, when it opens at 14:00: too late for a 15:00 departure.
    const lateSaturday = sampleDataWith((files) => {
      Object.assign(hoursOf(files, 'harvard-yard'), { wed: [], thu: [], fri: [], sat: [['14:00', '20:00']] });
    });
    const request = validTripRequest({ wishlist: ['Harvard Yard'] });
    expect(plan(oneDay(THURSDAY, ['harvard-yard']), request, lateSaturday).unscheduled).toEqual([
      { placeId: 'harvard-yard', name: 'Harvard Yard', reason: UNSCHEDULED_REASONS.noFit },
    ]);

    // Open every day, but it closes at 09:15: a 30-minute visit can never be finished in time.
    const closesEarly = sampleDataWith((files) => {
      Object.assign(hoursOf(files, 'sample-bakery-back-bay'), {
        wed: [['07:00', '09:15']],
        thu: [['07:00', '09:15']],
        fri: [['07:00', '09:15']],
        sat: [['07:00', '09:15']],
      });
    });
    const bakery = validTripRequest({ wishlist: ['Sample Bakery'] });
    const itinerary = plan(oneDay(THURSDAY, ['new-england-aquarium', 'sample-bakery-back-bay']), bakery, closesEarly);
    expect(itinerary.unscheduled).toEqual([
      { placeId: 'sample-bakery-back-bay', name: 'Sample Bakery', reason: 'does not fit in your days' },
    ]);
    expect(validateItinerary(itinerary, bakery, closesEarly)).toEqual([]);
  });

  it('never schedules a stop outside its opening hours in the bundled data, whatever order the AI gives', () => {
    const ids = sample.places.map((place) => place.id);
    const windows: [string, string][] = [
      ['2026-11-18T10:00', '2026-11-24T15:00'], // a week, with a Sunday (Giulia is closed, others open late)
      ['2026-11-21T08:00', '2026-11-23T20:00'],
    ];
    let checked = 0;
    for (const [arrival, departure] of windows) {
      const dates = listDates(arrival.slice(0, 10), departure.slice(0, 10));
      for (const shift of [0, 5, 11]) {
        const order = [...ids.slice(shift), ...ids.slice(0, shift)];
        const selection = {
          days: dates.map((date, index) => ({ date, placeIds: order.slice(index * 3, index * 3 + 3) })),
        };
        // An early start, so most places are not open yet when the traveler could first reach them.
        const request = validTripRequest({
          arrival,
          departure,
          wishlist: order.slice(0, 15),
          preferences: { ...validTripRequest().preferences, dayStart: '07:00', dayEnd: '23:00' },
        });
        const itinerary = plan(selection, request);
        for (const day of itinerary.days) {
          for (const item of day.items.filter((i) => i.placeId)) {
            const place = sample.placeById.get(item.placeId!)!;
            expect(
              isOpenFor(place, day.date, minutes(item.start), minutes(item.end)),
              `${place.id} on ${day.date} at ${item.start}-${item.end}`,
            ).toBe(true);
            checked += 1;
          }
        }
        expect(validateItinerary(itinerary, request, sample)).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('schedules the traveler’s six places once each, inside their hours, and lists the seventh entry', () => {
    const request = validTripRequest({
      wishlist: [
        'Saltie Girl - Lobster Roll',
        'Blank Street - Coffee/Matcha',
        'Guilia - Italian',
        'Quin Long - Malatang Hotpot',
        'Sail Loft - Lobster Roll, seafood portofino',
        'Mike’s Pastry',
        'Zei Wei - Taiwan noodle',
      ],
    });
    // The order the local server's scripted stand-in gives: two wishlist places on each middle day.
    const selection = {
      days: [
        { date: THURSDAY, placeIds: ['saltie-girl', 'blank-street-back-bay'] },
        { date: FRIDAY, placeIds: ['giulia', 'boston-sail-loft'] },
      ],
    };
    const itinerary = plan(selection, request);
    expect(
      stops(itinerary)
        .map((stop) => stop.placeId)
        .sort(),
    ).toEqual(['blank-street-back-bay', 'boston-sail-loft', 'giulia', 'mikes-pastry', 'saltie-girl', 'zhi-wei-cafe']);
    for (const day of itinerary.days) {
      for (const item of day.items.filter((i) => i.placeId)) {
        const place = sample.placeById.get(item.placeId!)!;
        expect(isOpenFor(place, day.date, minutes(item.start), minutes(item.end)), place.id).toBe(true);
        expect(item.isWishlist).toBe(true);
      }
    }
    expect(itinerary.unscheduled).toEqual([
      { name: 'Quin Long - Malatang Hotpot', reason: UNSCHEDULED_REASONS.notInData },
    ]);
    expect(validateItinerary(itinerary, request, sample)).toEqual([]);
  });
});
