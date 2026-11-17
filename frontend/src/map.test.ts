import type { DayPlan, ItineraryItem } from '@jarvel/shared';
import { describe, expect, it } from 'vitest';
import { AMAZON_MAP_STYLES, amazonStyleUrl, basemapFor, dayMap, pathBounds } from './map.js';

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

describe('pathBounds', () => {
  it('is the smallest box around the path, south-west corner first, each corner as [lng, lat]', () => {
    expect(pathBounds([HOTEL, LIBRARY, AQUARIUM])).toEqual([
      [LIBRARY.lng, LIBRARY.lat],
      [AQUARIUM.lng, AQUARIUM.lat],
    ]);
  });

  it('is a single point for one place, and nothing for an empty path', () => {
    expect(pathBounds([HOTEL])).toEqual([
      [HOTEL.lng, HOTEL.lat],
      [HOTEL.lng, HOTEL.lat],
    ]);
    expect(pathBounds([])).toBeUndefined();
  });
});

describe('the base map', () => {
  it('builds the Amazon Location style address its guide gives, with the key escaped', () => {
    expect(amazonStyleUrl('us-east-1', 'v1.public.abc')).toBe(
      'https://maps.geo.us-east-1.amazonaws.com/v2/styles/Standard/descriptor?key=v1.public.abc',
    );
    expect(amazonStyleUrl('eu-central-1', 'a b&c', 'Monochrome')).toBe(
      'https://maps.geo.eu-central-1.amazonaws.com/v2/styles/Monochrome/descriptor?key=a%20b%26c',
    );
    expect(AMAZON_MAP_STYLES).toEqual(['Standard', 'Monochrome', 'Hybrid', 'Satellite']);
  });

  it('is Amazon Location when the config has a Region and a maps key', () => {
    expect(basemapFor({ region: 'us-east-1', mapsApiKey: ' v1.public.abc\n' })).toEqual({
      provider: 'amazon',
      styleUrl: amazonStyleUrl('us-east-1', 'v1.public.abc', 'Standard'),
    });
    expect(basemapFor({ region: 'us-east-1', mapsApiKey: 'k', mapStyle: 'Satellite' })).toEqual({
      provider: 'amazon',
      styleUrl: amazonStyleUrl('us-east-1', 'k', 'Satellite'),
    });
  });

  it('is OpenStreetMap without a key, as in local development, or without a usable Region', () => {
    expect(basemapFor({ region: '' })).toEqual({ provider: 'openstreetmap' });
    expect(basemapFor({ region: 'us-east-1' })).toEqual({ provider: 'openstreetmap' });
    expect(basemapFor({ region: 'us-east-1', mapsApiKey: '  ' })).toEqual({ provider: 'openstreetmap' });
    expect(basemapFor({ region: '', mapsApiKey: 'k' })).toEqual({ provider: 'openstreetmap' });
    // A Region is part of the address the browser calls, so anything that is not one is refused.
    expect(basemapFor({ region: 'evil.example/x', mapsApiKey: 'k' })).toEqual({ provider: 'openstreetmap' });
    // /config.json is read as it is: a value of another type must not break the map.
    expect(basemapFor({ region: 'us-east-1', mapsApiKey: 42 as unknown as string })).toEqual({
      provider: 'openstreetmap',
    });
  });

  it('falls back to the Standard style for a style name it does not know', () => {
    const basemap = basemapFor({ region: 'us-east-1', mapsApiKey: 'k', mapStyle: 'Neon' as never });
    expect(basemap).toEqual({ provider: 'amazon', styleUrl: amazonStyleUrl('us-east-1', 'k', 'Standard') });
  });
});
