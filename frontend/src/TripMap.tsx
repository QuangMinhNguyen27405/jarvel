import 'maplibre-gl/dist/maplibre-gl.css';
import type { DayPlan } from '@jarvel/shared';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { dayParts } from './format.js';
import { dayMap, pathBounds, type Basemap } from './map.js';
import { createDayMapView, type DayMapView, type MapLibre } from './map-view.js';

const OPENSTREETMAP: Basemap = { provider: 'openstreetmap' };

interface BasemapChoice {
  /** The base map a new map starts on. */
  current(): Basemap;
  /** Amazon Location could not be used: the maps drawn after this one start on OpenStreetMap. */
  failed(): void;
}

const BasemapContext = createContext<BasemapChoice>({ current: () => OPENSTREETMAP, failed: () => {} });

/**
 * Says where the maps inside it get their picture. main.tsx sets it from /config.json: Amazon Location when the
 * config has a maps key, OpenStreetMap (no key, no cost) otherwise. Once Amazon Location has failed on this page,
 * for example because it refused the key, the next maps start on OpenStreetMap and do not fail the same way again.
 */
export function BasemapProvider({ basemap, children }: { basemap: Basemap; children: ReactNode }) {
  const failed = useRef(false);
  const choice = useMemo<BasemapChoice>(
    () => ({
      current: () => (failed.current ? OPENSTREETMAP : basemap),
      failed: () => {
        failed.current = true;
      },
    }),
    [basemap],
  );
  return <BasemapContext.Provider value={choice}>{children}</BasemapContext.Provider>;
}

const canMeasure = () => typeof ResizeObserver !== 'undefined';

/**
 * MapLibre is only fetched when a map is first shown, so the pages without a map do not carry it. Its worker file
 * is named here because a bundler moves it: MapLibre cannot find it by itself.
 */
async function loadMapLibre(): Promise<MapLibre> {
  const [lib, worker] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
  ]);
  lib.setWorkerUrl(worker.default);
  return lib;
}

/**
 * True once the box has a size. A map cannot be placed in a hidden (0 by 0) box, so it is only created when its
 * tab is first shown. Without ResizeObserver (the test DOM) the box cannot be measured: true at once.
 */
function useShown(box: RefObject<HTMLElement | null>): boolean {
  const [shown, setShown] = useState(() => !canMeasure());
  useEffect(() => {
    const element = box.current;
    if (shown || !element) return;
    const check = () => {
      if (element.clientWidth > 0 && element.clientHeight > 0) setShown(true);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [box, shown]);
  return shown;
}

/** The day's stops on a map: the hotel, each stop numbered in visiting order, and a line joining them in order. */
export function TripMap({ day }: { day: DayPlan }) {
  const { stops, path } = useMemo(() => dayMap(day), [day]);
  const bounds = useMemo(() => pathBounds(path), [path]);
  const basemap = useContext(BasemapContext);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const shown = useShown(frame);
  const mapped = stops.length > 0 && bounds !== undefined;

  useEffect(() => {
    const box = canvas.current;
    if (!shown || stops.length === 0 || !bounds || !box) return;
    let view: DayMapView | undefined;
    let left = false;
    loadMapLibre()
      .then((lib) => {
        if (left) return;
        view = createDayMapView(lib, box, { stops, path, bounds }, basemap.current(), (message) => {
          basemap.failed();
          console.error(message);
        });
      })
      .catch((error: unknown) => console.error('The map could not be drawn.', error));
    return () => {
      left = true;
      view?.remove();
    };
  }, [shown, stops, path, bounds, basemap]);

  if (!mapped) return null;
  return (
    <div className="trip-map" role="region" aria-label={`Map of ${dayParts(day.date).label}`}>
      <div className="trip-map-frame" ref={frame}>
        <div className="trip-map-canvas" ref={canvas} />
      </div>
      <ul className="map-key">
        {stops.map((stop) => (
          <li key={stop.id}>
            <span
              className={stop.kind === 'hotel' ? 'map-key-dot map-key-dot--hotel' : 'map-key-dot'}
              aria-hidden="true"
            >
              {stop.label}
            </span>
            <span>{stop.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
