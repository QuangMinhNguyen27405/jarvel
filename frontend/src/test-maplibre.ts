// A stand-in for MapLibre, for tests only: a test DOM has no WebGL, so no real map can be drawn there. It keeps
// what a map was asked to do, and puts the pins and a note of the line into the page so a test can look for them.
import type { MapLibre } from './map-view.js';

type Listener = (event: unknown) => void;

export class FakeMap {
  readonly root = document.createElement('div');
  readonly handlers = new Map<string, Listener[]>();
  readonly styles: unknown[];
  readonly fits: { bounds: unknown; options: unknown }[] = [];
  readonly controls: { control: unknown; position: unknown }[] = [];
  readonly markers: FakeMarker[] = [];
  readonly touchZoomRotate = { rotation: true, disableRotation: () => void (this.touchZoomRotate.rotation = false) };
  readonly keyboard = { rotation: true, disableRotation: () => void (this.keyboard.rotation = false) };
  sources: Record<string, unknown> = {};
  layers: { id: string }[] = [];
  removed = false;

  constructor(readonly options: { container: HTMLElement; style: unknown } & Record<string, unknown>) {
    this.styles = [options.style];
    this.root.dataset.testid = 'map';
    this.showStyle(options.style);
    options.container.append(this.root);
  }

  private showStyle(style: unknown): void {
    this.root.dataset.style = typeof style === 'string' ? style : JSON.stringify(style);
  }

  on(type: string, listener: Listener): this {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
    return this;
  }

  once(type: string, listener: Listener): this {
    const wrapped: Listener = (event) => {
      this.handlers.set(type, (this.handlers.get(type) ?? []).filter((entry) => entry !== wrapped));
      listener(event);
    };
    return this.on(type, wrapped);
  }

  /** What MapLibre does itself: tells the listeners of `type`. */
  emit(type: string, event: unknown = {}): void {
    for (const listener of [...(this.handlers.get(type) ?? [])]) listener(event);
  }

  addControl(control: unknown, position?: unknown): this {
    this.controls.push({ control, position });
    return this;
  }

  getSource(id: string): unknown {
    return this.sources[id];
  }

  addSource(id: string, source: { data?: { geometry?: { coordinates?: unknown[] } } }): void {
    this.sources[id] = source;
    const line = document.createElement('span');
    line.dataset.testid = 'line';
    line.dataset.points = String(source.data?.geometry?.coordinates?.length ?? 0);
    this.root.append(line);
  }

  addLayer(layer: { id: string }): void {
    this.layers.push(layer);
  }

  /** A new style drops every source and layer that was added to the old one. */
  setStyle(style: unknown): void {
    this.styles.push(style);
    this.showStyle(style);
    this.sources = {};
    this.layers = [];
    for (const line of this.root.querySelectorAll('[data-testid="line"]')) line.remove();
  }

  fitBounds(bounds: unknown, options: unknown): void {
    this.fits.push({ bounds, options });
  }

  remove(): void {
    this.removed = true;
    this.root.remove();
  }
}

export class FakePopup {
  text = '';
  constructor(readonly options: unknown) {}
  setText(text: string): this {
    this.text = text;
    return this;
  }
}

export class FakeMarker {
  readonly element: HTMLElement;
  lngLat: unknown;
  popup: FakePopup | undefined;
  removed = false;

  constructor(readonly options: { element: HTMLElement } & Record<string, unknown>) {
    this.element = options.element;
  }

  setLngLat(lngLat: unknown): this {
    this.lngLat = lngLat;
    return this;
  }

  setPopup(popup: FakePopup): this {
    this.popup = popup;
    return this;
  }

  addTo(map: FakeMap): this {
    this.element.dataset.testid = 'marker';
    if (this.popup) {
      const popup = document.createElement('span');
      popup.textContent = this.popup.text;
      this.element.append(popup);
    }
    map.root.append(this.element);
    map.markers.push(this);
    return this;
  }

  remove(): this {
    this.removed = true;
    this.element.remove();
    return this;
  }
}

export class FakeNavigationControl {
  constructor(readonly options: unknown) {}
}

export interface FakeMapLibre {
  /** Every map made so far, oldest first. */
  maps: FakeMap[];
  /** True makes each new map report its style and first draw by itself, a moment after it is made. */
  loads: boolean;
  /** The module to hand to the code under test, or to give `vi.mock('maplibre-gl', ...)`. */
  lib: MapLibre & { setWorkerUrl: (url: string) => void };
  workerUrls: string[];
}

export function fakeMapLibre(options: { loads?: boolean } = {}): FakeMapLibre {
  const maps: FakeMap[] = [];
  const workerUrls: string[] = [];
  const fake = { maps, workerUrls, loads: options.loads ?? false } as FakeMapLibre;
  class TrackedMap extends FakeMap {
    constructor(mapOptions: ConstructorParameters<typeof FakeMap>[0]) {
      super(mapOptions);
      maps.push(this);
      if (fake.loads) {
        queueMicrotask(() => {
          this.emit('style.load');
          this.emit('load');
        });
      }
    }
  }
  const lib = {
    Map: TrackedMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    NavigationControl: FakeNavigationControl,
    setWorkerUrl: (url: string) => void workerUrls.push(url),
  };
  fake.lib = lib as unknown as FakeMapLibre['lib'];
  return fake;
}

/** The one stand-in that App.test.tsx puts in MapLibre's place, so a test can reach the maps the app made. */
export const appMapLibre = fakeMapLibre({ loads: true });
