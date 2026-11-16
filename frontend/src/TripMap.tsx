import 'leaflet/dist/leaflet.css';
import type { DayPlan } from '@jarvel/shared';
import { divIcon, latLngBounds, type FitBoundsOptions, type LatLngBounds } from 'leaflet';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { dayParts } from './format.js';
import { dayMap } from './map.js';

// OpenStreetMap tiles: no API key and no cost. Their usage policy requires this attribution on the map.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const FIT: FitBoundsOptions = { padding: [36, 36], maxZoom: 15 };

const canMeasure = () => typeof ResizeObserver !== 'undefined';

/**
 * A teardrop pin drawn in CSS, so no marker image has to be bundled: teal with a white number for a stop, mustard
 * with a dark "H" for the hotel. The tip of the drop sits on the place.
 */
function pin(label: string, hotel: boolean) {
  return divIcon({
    className: hotel ? 'map-pin map-pin--hotel' : 'map-pin',
    html: `<span class="map-pin-drop"><span class="map-pin-label">${label}</span></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 36],
    popupAnchor: [0, -34],
  });
}

/**
 * Keeps the day in view when the map's box changes size: on a phone the map has its own tab and is hidden while
 * another tab shows, and a window can be resized. Leaflet then has to measure again and refit.
 */
function KeepFitted({ bounds }: { bounds: LatLngBounds }) {
  const map = useMap();
  /** The box size the day was last fitted to; it outlives a re-subscription. */
  const fitted = useRef<string>(undefined);
  useEffect(() => {
    if (!canMeasure()) return;
    const box = map.getContainer();
    if (fitted.current === undefined) {
      const size = map.getSize();
      fitted.current = `${size.x}x${size.y}`;
    }
    const observer = new ResizeObserver(() => {
      const width = box.clientWidth;
      const height = box.clientHeight;
      if (width === 0 || height === 0) return; // hidden: refit once it shows again
      // Leaflet's own size can be stale too: it measures on window resizes, even while the box is hidden.
      const known = map.getSize();
      const size = `${width}x${height}`;
      if (size === fitted.current && known.x === width && known.y === height) return;
      fitted.current = size;
      map.invalidateSize({ pan: false });
      map.fitBounds(bounds, { ...FIT, animate: false });
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [map, bounds]);
  return null;
}

/**
 * True once the box has a size. Leaflet cannot place a map in a hidden (0 by 0) box, so the map is only created
 * when its tab is first shown. Without ResizeObserver (the test DOM) the box cannot be measured: true at once.
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
  const positions = useMemo(() => path.map((point): [number, number] => [point.lat, point.lng]), [path]);
  const bounds = useMemo(() => (positions.length > 0 ? latLngBounds(positions) : undefined), [positions]);
  const frame = useRef<HTMLDivElement>(null);
  const shown = useShown(frame);
  if (stops.length === 0 || !bounds) return null;
  return (
    <div className="trip-map" role="region" aria-label={`Map of ${dayParts(day.date).label}`}>
      <div className="trip-map-frame" ref={frame}>
        {shown ? (
          <MapContainer bounds={bounds} boundsOptions={FIT} scrollWheelZoom={false} className="trip-map-canvas">
            <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
            {positions.length > 1 && (
              <Polyline
                positions={positions}
                pathOptions={{ color: '#155E67', weight: 3, dashArray: '7 6', lineCap: 'round', lineJoin: 'round' }}
              />
            )}
            {stops.map((stop) => (
              <Marker
                key={stop.id}
                position={[stop.lat, stop.lng]}
                icon={pin(stop.label, stop.kind === 'hotel')}
                title={stop.title}
              >
                <Popup>
                  {stop.label}. {stop.title}
                </Popup>
              </Marker>
            ))}
            <KeepFitted bounds={bounds} />
          </MapContainer>
        ) : (
          <div className="trip-map-canvas" />
        )}
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
