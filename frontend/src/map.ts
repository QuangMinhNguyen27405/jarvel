import type { DayPlan, FrontendConfig } from '@jarvel/shared';

/** The map styles Amazon Location offers. */
export const AMAZON_MAP_STYLES = ['Standard', 'Monochrome', 'Hybrid', 'Satellite'] as const;
export type AmazonMapStyle = (typeof AMAZON_MAP_STYLES)[number];

/**
 * Where the map's picture comes from: Amazon Location, drawn from its style at `styleUrl`, or OpenStreetMap, which
 * needs no key and is what a setup without an Amazon Location key shows.
 */
export type Basemap = { provider: 'amazon'; styleUrl: string } | { provider: 'openstreetmap' };

const AWS_REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;

/** The address of an Amazon Location map style, as its guide gives it. The key is a browser key: it only reads tiles. */
export function amazonStyleUrl(region: string, apiKey: string, style: AmazonMapStyle = 'Standard'): string {
  return `https://maps.geo.${region}.amazonaws.com/v2/styles/${style}/descriptor?key=${encodeURIComponent(apiKey)}`;
}

/** Amazon Location when /config.json names a Region and a maps key; OpenStreetMap otherwise. */
export function basemapFor(config: Pick<FrontendConfig, 'region' | 'mapsApiKey' | 'mapStyle'>): Basemap {
  const apiKey = typeof config.mapsApiKey === 'string' ? config.mapsApiKey.trim() : '';
  if (!apiKey || !AWS_REGION.test(config.region)) return { provider: 'openstreetmap' };
  const style = AMAZON_MAP_STYLES.find((name) => name === config.mapStyle) ?? 'Standard';
  return { provider: 'amazon', styleUrl: amazonStyleUrl(config.region, apiKey, style) };
}

/** A box on the map as MapLibre takes it: the south-west corner, then the north-east one, each as [lng, lat]. */
export type MapBounds = [[west: number, south: number], [east: number, north: number]];

/** The smallest box that holds every point of the path, or undefined for an empty path. */
export function pathBounds(path: MapPoint[]): MapBounds | undefined {
  if (path.length === 0) return undefined;
  const lats = path.map((point) => point.lat);
  const lngs = path.map((point) => point.lng);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

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
