import type { DayPlan } from '@jarvel/shared';

export interface MapPoint {
  lat: number;
  lng: number;
}

/** One marker on a day's map: the hotel ("H") or a stop numbered in visiting order. */
export interface MapStop extends MapPoint {
  id: string;
  title: string;
  kind: 'hotel' | 'stop';
  label: string;
}

export interface DayMap {
  stops: MapStop[];
  /** Every located item in visiting order, with repeats in a row merged: the line drawn on the map. */
  path: MapPoint[];
}

const samePoint = (a: MapPoint, b: MapPoint) => a.lat === b.lat && a.lng === b.lng;

/**
 * The day's mapped stops in visiting order, from the items that have a location (visits, meals and the hotel).
 * The hotel gets one marker however often the day passes it; the path starts and ends there when the day does.
 */
export function dayMap(day: DayPlan): DayMap {
  const stops: MapStop[] = [];
  const path: MapPoint[] = [];
  let hotelMarked = false;
  let number = 0;
  for (const item of day.items) {
    if (!item.location) continue;
    const point = { lat: item.location.lat, lng: item.location.lng };
    const last = path.at(-1);
    if (!last || !samePoint(last, point)) path.push(point);
    if (item.kind === 'hotel') {
      if (hotelMarked) continue;
      hotelMarked = true;
      stops.push({ ...point, id: item.id, title: item.title, kind: 'hotel', label: 'H' });
    } else {
      number += 1;
      stops.push({ ...point, id: item.id, title: item.title, kind: 'stop', label: String(number) });
    }
  }
  return { stops, path };
}
