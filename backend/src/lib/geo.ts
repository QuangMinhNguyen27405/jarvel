// Distance and walking-time estimates between coordinates.
import type { Station } from '@jarvel/shared';

/** Average walking speed: 80 m per minute (4.8 km/h). */
export const WALK_METERS_PER_MINUTE = 80;
/** Streets are not straight lines: straight-line distance is stretched by this factor. */
export const WALK_DETOUR_FACTOR = 1.25;

export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated walking minutes between two points, rounded up; 0 for the same point. */
export function walkMinutesBetween(a: Point, b: Point): number {
  const meters = haversineKm(a, b) * 1000 * WALK_DETOUR_FACTOR;
  return Math.ceil(meters / WALK_METERS_PER_MINUTE);
}

export interface StationDistance {
  stationId: string;
  walkMinutes: number;
}

/** Stations within `maxWalkMinutes` of `point`, nearest first. */
export function stationsWithinWalk(point: Point, stations: Station[], maxWalkMinutes: number): StationDistance[] {
  return stations
    .map((station) => ({ stationId: station.id, walkMinutes: walkMinutesBetween(point, station) }))
    .filter((candidate) => candidate.walkMinutes <= maxWalkMinutes)
    .sort((a, b) => a.walkMinutes - b.walkMinutes || a.stationId.localeCompare(b.stationId));
}
