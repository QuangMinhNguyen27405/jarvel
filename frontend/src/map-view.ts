// Draws one day on a MapLibre map: the base map (Amazon Location, or OpenStreetMap), the numbered pins and the line
// joining them. It is plain code with the MapLibre library handed in, so tests run it against a stand-in: a test
// DOM has no WebGL to draw a real map with.
import type { ErrorEvent, StyleSpecification } from 'maplibre-gl';
import type { Basemap, DayMap, MapBounds } from './map.js';

/** The parts of MapLibre this file uses. */
export type MapLibre = Pick<typeof import('maplibre-gl'), 'Map' | 'Marker' | 'Popup' | 'NavigationControl'>;

/** OpenStreetMap tiles: no API key and no cost. Their usage policy requires this attribution on the map. */
export const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    openstreetmap: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'openstreetmap', type: 'raster', source: 'openstreetmap' }],
};

const FIT = { padding: 36, maxZoom: 15 };
const PATH = 'day-path';
/** The pin is a 30 by 30 box whose tip hangs 6px below it; this puts the tip on the place. */
const PIN_OFFSET: [number, number] = [-15, -36];
const POPUP_OFFSET: [number, number] = [0, -34];

export interface DayMapData extends DayMap {
  bounds: MapBounds;
}

export interface DayMapView {
  /** Removes the map and its pins from the page. */
  remove(): void;
}

/**
 * A teardrop pin drawn in CSS, so no marker image has to be bundled: teal with a white number for a stop, mustard
 * with a dark "H" for the hotel. MapLibre moves the outer box itself, so only the inner drop is turned.
 */
function pin(label: string, title: string, hotel: boolean): HTMLElement {
  const box = document.createElement('div');
  box.className = hotel ? 'map-pin map-pin--hotel' : 'map-pin';
  box.title = title;
  const drop = document.createElement('span');
  drop.className = 'map-pin-drop';
  const text = document.createElement('span');
  text.className = 'map-pin-label';
  text.textContent = label;
  drop.append(text);
  box.append(drop);
  return box;
}

const httpStatus = (event: ErrorEvent): number | undefined => (event.error as { status?: number } | undefined)?.status;

/**
 * Draws the day in `container`. The map stays flat and north-up, and the page scrolls past it (no wheel zoom).
 * When the Amazon Location map cannot be loaded (a refused key, or no connection to it), `report` is told once
 * and OpenStreetMap is shown in its place, so the day's stops are never left on an empty map.
 */
export function createDayMapView(
  lib: MapLibre,
  container: HTMLElement,
  day: DayMapData,
  basemap: Basemap,
  report: (message: string) => void = (message) => console.error(message),
): DayMapView {
  const map = new lib.Map({
    container,
    style: basemap.provider === 'amazon' ? basemap.styleUrl : OSM_STYLE,
    bounds: day.bounds,
    fitBoundsOptions: FIT,
    scrollZoom: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    rollEnabled: false,
    attributionControl: { compact: false },
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-left');

  // The line is part of the style, and a change of style drops it, so it is drawn again for each style that loads.
  const drawPath = () => {
    if (day.path.length < 2 || map.getSource(PATH)) return;
    map.addSource(PATH, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: day.path.map((point) => [point.lng, point.lat]) },
      },
    });
    map.addLayer({
      id: PATH,
      type: 'line',
      source: PATH,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#155E67', 'line-width': 3, 'line-dasharray': [2.3, 2] },
    });
  };
  map.on('style.load', drawPath);

  // Until its first full draw, the Amazon Location map can still turn out to be unusable: its style did not load
  // at all, or the service refused the key (HTTP 401 or 403). After that, a failed tile is only a gap in the picture.
  let styleLoaded = false;
  let drawn = false;
  let onAmazon = basemap.provider === 'amazon';
  map.once('style.load', () => {
    styleLoaded = true;
  });
  map.once('load', () => {
    drawn = true;
  });
  map.on('error', (event) => {
    if (!onAmazon || drawn) return;
    const status = httpStatus(event);
    const refused = status === 401 || status === 403;
    if (styleLoaded && !refused) return;
    onAmazon = false;
    report(
      `The Amazon Location map could not be loaded${status ? ` (HTTP ${status})` : ''}. Showing OpenStreetMap instead.`,
    );
    map.setStyle(OSM_STYLE);
  });

  // The map's box changes size when its tab is shown again on a phone, or the window is resized. MapLibre measures
  // the box itself; the day is then put back in view. A hidden box (0 by 0) is fitted once it shows again.
  map.on('resize', () => {
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    map.fitBounds(day.bounds, { ...FIT, animate: false });
  });

  const markers = day.stops.map((stop) =>
    new lib.Marker({ element: pin(stop.label, stop.title, stop.kind === 'hotel'), anchor: 'top-left', offset: PIN_OFFSET })
      .setLngLat([stop.lng, stop.lat])
      .setPopup(new lib.Popup({ offset: POPUP_OFFSET, closeButton: false }).setText(`${stop.label}. ${stop.title}`))
      .addTo(map),
  );

  return {
    remove: () => {
      for (const marker of markers) marker.remove();
      map.remove();
    },
  };
}
