import { afterEach, describe, expect, it, vi } from 'vitest';
import { amazonStyleUrl, type Basemap, type MapBounds } from './map.js';
import { createDayMapView, OSM_STYLE, type DayMapData } from './map-view.js';
import { fakeMapLibre, type FakeNavigationControl } from './test-maplibre.js';

const HOTEL = { lat: 42.3586, lng: -71.0585 };
const LIBRARY = { lat: 42.3493, lng: -71.0782 };
const BOUNDS: MapBounds = [
  [-71.0782, 42.3493],
  [-71.0585, 42.3586],
];

const DAY: DayMapData = {
  stops: [
    { ...HOTEL, id: 'h', title: 'My <b>hotel</b>', kind: 'hotel', label: 'H' },
    { ...LIBRARY, id: 'l', title: 'Library', kind: 'stop', label: '1' },
  ],
  path: [HOTEL, LIBRARY, HOTEL],
  bounds: BOUNDS,
};

const OSM: Basemap = { provider: 'openstreetmap' };
const AMAZON: Basemap = { provider: 'amazon', styleUrl: amazonStyleUrl('us-east-1', 'v1.public.test') };

function draw(basemap: Basemap, day: DayMapData = DAY) {
  const fake = fakeMapLibre();
  const container = document.createElement('div');
  document.body.append(container);
  const report = vi.fn();
  const view = createDayMapView(fake.lib, container, day, basemap, report);
  return { map: fake.maps[0]!, container, report, view };
}

function sized(container: HTMLElement, width: number, height: number) {
  Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: height, configurable: true });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('createDayMapView', () => {
  it('draws OpenStreetMap, fitted to the day, flat, and without wheel zoom', () => {
    const { map, container } = draw(OSM);
    expect(map.options).toMatchObject({
      container,
      style: OSM_STYLE,
      bounds: BOUNDS,
      fitBoundsOptions: { padding: 36, maxZoom: 15 },
      scrollZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      rollEnabled: false,
    });
    expect(map.touchZoomRotate.rotation).toBe(false);
    expect(map.keyboard.rotation).toBe(false);
    expect(JSON.stringify(OSM_STYLE)).toContain('OpenStreetMap');
  });

  it('draws the Amazon Location style when one is given', () => {
    const { map } = draw(AMAZON);
    expect(map.options.style).toBe(
      'https://maps.geo.us-east-1.amazonaws.com/v2/styles/Standard/descriptor?key=v1.public.test',
    );
  });

  it('has zoom buttons at the top left and no compass', () => {
    const { map } = draw(OSM);
    expect(map.controls).toHaveLength(1);
    expect(map.controls[0]!.position).toBe('top-left');
    expect((map.controls[0]!.control as FakeNavigationControl).options).toEqual({ showCompass: false });
  });

  it('puts one pin per stop with its tip on the place, the hotel in its own color, and the name in a popup', () => {
    const { map } = draw(OSM);
    expect(map.markers.map((marker) => marker.lngLat)).toEqual([
      [HOTEL.lng, HOTEL.lat],
      [LIBRARY.lng, LIBRARY.lat],
    ]);
    expect(map.markers.map((marker) => marker.element.className)).toEqual(['map-pin map-pin--hotel', 'map-pin']);
    expect(map.markers.map((marker) => marker.element.querySelector('.map-pin-label')?.textContent)).toEqual(['H', '1']);
    expect(map.markers.map((marker) => marker.popup?.text)).toEqual(['H. My <b>hotel</b>', '1. Library']);
    expect(map.markers[0]!.options).toMatchObject({ anchor: 'top-left', offset: [-15, -36] });
    // A place name is text, never markup.
    expect(map.markers[0]!.element.title).toBe('My <b>hotel</b>');
    expect(map.markers[0]!.element.querySelector('b')).toBeNull();
  });

  it('draws the line through the path once the style has loaded, as [lng, lat] points, and only once', () => {
    const { map } = draw(OSM);
    expect(map.sources).toEqual({});
    map.emit('style.load');
    map.emit('style.load');
    const source = map.sources['day-path'] as { data: { geometry: { type: string; coordinates: number[][] } } };
    expect(source.data.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [HOTEL.lng, HOTEL.lat],
        [LIBRARY.lng, LIBRARY.lat],
        [HOTEL.lng, HOTEL.lat],
      ],
    });
    expect(map.layers).toHaveLength(1);
    expect(map.layers[0]).toMatchObject({ id: 'day-path', type: 'line', paint: { 'line-color': '#155E67' } });
  });

  it('draws no line for a day with a single place', () => {
    const { map } = draw(OSM, { ...DAY, stops: [DAY.stops[0]!], path: [HOTEL] });
    map.emit('style.load');
    expect(map.sources).toEqual({});
  });

  it('shows OpenStreetMap, says so once, and draws the line again when Amazon Location refuses the key', () => {
    const { map, report } = draw(AMAZON);
    map.emit('style.load');
    map.emit('error', { error: Object.assign(new Error('Forbidden'), { status: 403, url: 'https://secret' }) });
    map.emit('error', { error: Object.assign(new Error('Forbidden'), { status: 403 }) });
    expect(map.styles).toEqual([AMAZON.provider === 'amazon' && AMAZON.styleUrl, OSM_STYLE]);
    expect(report).toHaveBeenCalledTimes(1);
    const message = report.mock.calls[0]![0] as string;
    expect(message).toBe('The Amazon Location map could not be loaded (HTTP 403). Showing OpenStreetMap instead.');
    expect(message).not.toContain('v1.public.test');
    expect(map.sources).toEqual({});
    map.emit('style.load');
    expect(map.sources['day-path']).toBeDefined();
  });

  it('shows OpenStreetMap when the Amazon Location style does not load at all', () => {
    const { map, report } = draw(AMAZON);
    map.emit('error', { error: new TypeError('Failed to fetch') });
    expect(map.styles).toHaveLength(2);
    expect(report).toHaveBeenCalledWith('The Amazon Location map could not be loaded. Showing OpenStreetMap instead.');
  });

  it('keeps the Amazon Location map through a failed tile, before and after its first draw', () => {
    const { map, report } = draw(AMAZON);
    map.emit('style.load');
    map.emit('error', { error: Object.assign(new Error('Server error'), { status: 500 }) });
    map.emit('error', { error: new Error('a tile did not arrive') });
    map.emit('load');
    map.emit('error', { error: Object.assign(new Error('Forbidden'), { status: 403 }) });
    expect(map.styles).toHaveLength(1);
    expect(report).not.toHaveBeenCalled();
  });

  it('never swaps the style of an OpenStreetMap map on an error', () => {
    const { map, report } = draw(OSM);
    map.emit('error', { error: Object.assign(new Error('Forbidden'), { status: 403 }) });
    expect(map.styles).toHaveLength(1);
    expect(report).not.toHaveBeenCalled();
  });

  it('puts the day back in view when the box changes size, and waits while the box is hidden', () => {
    const { map, container } = draw(OSM);
    sized(container, 0, 0);
    map.emit('resize');
    expect(map.fits).toEqual([]);
    sized(container, 640, 430);
    map.emit('resize');
    expect(map.fits).toEqual([{ bounds: BOUNDS, options: { padding: 36, maxZoom: 15, animate: false } }]);
  });

  it('removes the pins and the map', () => {
    const { map, container, view } = draw(OSM);
    expect(container.querySelectorAll('[data-testid="marker"]')).toHaveLength(2);
    view.remove();
    expect(map.removed).toBe(true);
    expect(map.markers.every((marker) => marker.removed)).toBe(true);
    expect(container.children).toHaveLength(0);
  });
});
