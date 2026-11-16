import type { DayPlan, ItineraryItem } from '@jarvel/shared';
import { describe, expect, it } from 'vitest';
import { dayMap } from './map.js';

const HOTEL = { lat: 42.3586, lng: -71.0585 };
const LIBRARY = { lat: 42.3493, lng: -71.0782 };
const AQUARIUM = { lat: 42.3592, lng: -71.0495 };

function item(id: string, kind: ItineraryItem['kind'], title: string, location?: ItineraryItem['location']) {
  return { id, kind, title, start: '10:00', end: '11:00', description: '', cost: { low: 0, high: 0 }, location };
}

function day(items: ReturnType<typeof item>[]): DayPlan {
  return { date: '2026-11-19', items } as unknown as DayPlan;
}

describe('dayMap', () => {
  it('numbers the stops in visiting order and marks the hotel once', () => {
    const map = dayMap(
      day([
        item('a', 'transit', 'Hotel to Library'),
        item('b', 'visit', 'Library', LIBRARY),
        item('c', 'transit', 'Library to Aquarium'),
        item('d', 'meal', 'Aquarium cafe', AQUARIUM),
        item('e', 'transit', 'Aquarium to Hotel'),
        item('f', 'hotel', 'Back at My hotel', HOTEL),
      ]),
    );
    expect(map.stops.map((s) => [s.label, s.title, s.kind])).toEqual([
      ['1', 'Library', 'stop'],
      ['2', 'Aquarium cafe', 'stop'],
      ['H', 'Back at My hotel', 'hotel'],
    ]);
    expect(map.path).toEqual([LIBRARY, AQUARIUM, HOTEL]);
  });

  it('starts and ends the line at the hotel, with one hotel marker and repeats in a row merged', () => {
    const map = dayMap(
      day([
        item('a', 'hotel', 'Check in', HOTEL),
        item('b', 'visit', 'Library', LIBRARY),
        item('c', 'hotel', 'Back at My hotel', HOTEL),
        item('d', 'hotel', 'Collect your bags', HOTEL),
      ]),
    );
    expect(map.stops.filter((s) => s.kind === 'hotel')).toHaveLength(1);
    expect(map.path).toEqual([HOTEL, LIBRARY, HOTEL]);
  });

  it('leaves out items without a location', () => {
    const map = dayMap(day([item('a', 'airport', 'Arrive'), item('b', 'visit', 'Library', LIBRARY)]));
    expect(map.stops).toHaveLength(1);
    expect(map.path).toEqual([LIBRARY]);
  });

  it('gives an empty map for a day with nothing located (for example a plan made before locations existed)', () => {
    expect(dayMap(day([]))).toEqual({ stops: [], path: [] });
    expect(dayMap(day([item('a', 'visit', 'Old stop')]))).toEqual({ stops: [], path: [] });
  });
});
