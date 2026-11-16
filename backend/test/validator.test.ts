import type { Itinerary } from '@jarvel/shared';
import { describe, expect, it } from 'vitest';
import { loadBostonData } from '../src/lib/data.js';
import { buildItinerary } from '../src/lib/scheduler.js';
import { sunsetHHMM } from '../src/lib/sun.js';
import { validateItinerary, type ViolationRule } from '../src/lib/validator.js';
import { area, hoursOf, sampleDataWith } from './fixtures/data.js';
import { baseSelection } from './fixtures/fake-ai.js';
import { validTripRequest } from './fixtures/requests.js';

const data = loadBostonData();
const request = validTripRequest();

function goodPlan(): Itinerary {
  return buildItinerary({
    request,
    data,
    selection: baseSelection(),
    modelId: 'm',
    generatedAt: '2026-10-23T16:00:00Z',
  });
}

const rules = (itinerary: Itinerary, d = data): ViolationRule[] =>
  validateItinerary(itinerary, request, d).map((v) => v.rule);

/** Day 2 of the base plan: hotel -> aquarium (leg, visit) -> Faneuil Hall (leg, visit) -> hotel (leg, marker). */
const day2 = (itinerary: Itinerary) => itinerary.days[1]!;

describe('validateItinerary (FR4.3)', () => {
  it('finds zero violations in a plan built by the scheduler (AC4.4.4)', () => {
    expect(validateItinerary(goodPlan(), request, data)).toEqual([]);
  });

  it('finds overlapping items', () => {
    const itinerary = goodPlan();
    day2(itinerary).items[1]!.end = '23:00';
    expect(rules(itinerary)).toContain('overlap');
  });

  it('finds a stop the AI placed after the area’s avoid-after time (AC4.4.1)', () => {
    const strictData = sampleDataWith((files) => {
      area(files, 'waterfront').avoidAfter = '10:00';
    });
    // The good plan keeps the aquarium at 09:09-11:09, which breaks the new 10:00 avoid-after rule.
    expect(rules(goodPlan(), strictData)).toContain('safety');
  });

  it('finds a ride before the first train or after the last one (AC4.7.3)', () => {
    const itinerary = goodPlan();
    const leg = day2(itinerary).items[0]!;
    leg.start = '04:00';
    leg.end = `04:${String(leg.transit!.durationMinutes).padStart(2, '0')}`;
    expect(rules(itinerary)).toContain('service-hours');
  });

  it('finds a walk over the walking limit and legs whose times do not add up', () => {
    const itinerary = goodPlan();
    const walk = day2(itinerary).items[0]!.transit!.steps.find((s) => s.kind === 'walk')!;
    walk.minutes = 40;
    expect(rules(itinerary)).toEqual(expect.arrayContaining(['walk-limit', 'leg-time']));
  });

  it('finds an unknown place, a duplicate stop and a missing leg', () => {
    const unknown = goodPlan();
    day2(unknown).items[1]!.placeId = 'invented-place';
    expect(rules(unknown)).toContain('unknown-place');

    const duplicate = goodPlan();
    duplicate.days[2]!.items[1]!.placeId = 'new-england-aquarium';
    expect(rules(duplicate)).toContain('duplicate-place');

    const noLeg = goodPlan();
    day2(noLeg).items.splice(2, 1); // remove aquarium -> Faneuil Hall
    expect(rules(noLeg)).toContain('missing-leg');
  });

  it('finds a wishlist entry that is neither scheduled nor listed, and a missing disclaimer, guidance or day', () => {
    const itinerary = goodPlan();
    itinerary.days[2]!.items = itinerary.days[2]!.items.filter((i) => i.placeId !== 'harvard-yard');
    itinerary.disclaimer = '';
    itinerary.days[0]!.safetyGuidance = [];
    itinerary.days.pop();
    expect(rules(itinerary)).toEqual(expect.arrayContaining(['wishlist', 'disclaimer', 'guidance', 'day-count']));
  });

  it('finds items outside the day window and invalid times', () => {
    const late = goodPlan();
    const marker = day2(late).items.at(-1)!;
    marker.start = '22:00';
    marker.end = '22:00';
    expect(rules(late)).toContain('out-of-window');

    const broken = goodPlan();
    day2(broken).items[1]!.start = '25:99';
    expect(rules(broken)).toContain('bad-time');
  });
});

describe('validateItinerary: opening hours (FR12, US7.3)', () => {
  // The good plan has the aquarium on Thursday Nov 19 at 09:09-11:09.
  const aquariumOn = (thursday: [string, string][] | undefined) =>
    sampleDataWith((files) => {
      if (thursday) hoursOf(files, 'new-england-aquarium').thu = thursday;
      else delete hoursOf(files, 'new-england-aquarium').thu;
    });

  it('finds a stop that starts before its place opens', () => {
    const plan = goodPlan();
    const violations = validateItinerary(plan, request, aquariumOn([['12:00', '17:00']]));
    expect(violations).toEqual([
      {
        rule: 'opening-hours',
        date: '2026-11-19',
        itemId: day2(plan).items[1]!.id,
        message: 'New England Aquarium is not open for all of 09:09-11:09 on 2026-11-19',
      },
    ]);
  });

  it('finds a stop on a day its place is closed, and one that runs past closing', () => {
    expect(rules(goodPlan(), aquariumOn([]))).toEqual(['opening-hours']);
    expect(rules(goodPlan(), aquariumOn([['09:00', '11:00']]))).toEqual(['opening-hours']);
    expect(
      rules(
        goodPlan(),
        aquariumOn([
          ['09:00', '10:00'],
          ['10:30', '12:00'],
        ]),
      ),
    ).toEqual(['opening-hours']); // open at both ends, but not for the whole visit
  });

  it('accepts a stop that fills its opening period exactly, and any stop when the hours are unknown', () => {
    expect(rules(goodPlan(), aquariumOn([['09:09', '11:09']]))).toEqual([]);
    expect(rules(goodPlan(), aquariumOn(undefined))).toEqual([]);
  });

  it('judges a day’s first leg by the hotel’s own area when it leaves after sunset', () => {
    // A dinner-only stop: the traveler leaves the hotel after dark, and nothing comes before that leg in the day.
    const dinnerOnly = sampleDataWith((files) => {
      hoursOf(files, 'sample-pho-house-chinatown').fri = [['17:30', '22:00']];
    });
    const dinner = validTripRequest({ wishlist: ['Sample Pho House'] });
    const itinerary = buildItinerary({
      request: dinner,
      data: dinnerOnly,
      selection: { days: [{ date: '2026-11-20', placeIds: ['sample-pho-house-chinatown'] }] },
      modelId: 'm',
      generatedAt: '2026-10-23T16:00:00Z',
    });
    const first = itinerary.days[2]!.items[0]!;
    expect(first.kind).toBe('transit');
    expect(first.start > sunsetHHMM('2026-11-20')).toBe(true);
    expect(validateItinerary(itinerary, dinner, dinnerOnly)).toEqual([]);

    // From a hotel outside every safety area, the same leg is still refused after dark (FR4.5).
    const unknownHotel = { ...dinner, hotel: { ...dinner.hotel, lat: 42.33, lng: -71.03 } };
    expect(validateItinerary(itinerary, unknownHotel, dinnerOnly)).toContainEqual(
      expect.objectContaining({ rule: 'safety', itemId: first.id }),
    );
  });
});
