/** A stand-in for maplibre-gl (no WebGL in jsdom). Use: vi.mock('maplibre-gl', () => import('./maplibre-mock')). */
export const mapCalls: {
  maps: Record<string, unknown>[];
  sources: { id: string; data: unknown }[];
  layers: string[];
  data: unknown[];
  pins: [number, number][];
  fits: number;
  removed: number;
} = { maps: [], sources: [], layers: [], data: [], pins: [], fits: 0, removed: 0 };

export function resetMapCalls() {
  mapCalls.maps = [];
  mapCalls.sources = [];
  mapCalls.layers = [];
  mapCalls.data = [];
  mapCalls.pins = [];
  mapCalls.fits = 0;
  mapCalls.removed = 0;
}

export class Map {
  constructor(options: Record<string, unknown>) {
    mapCalls.maps.push(options);
  }
  on(event: string, callback: () => void) {
    if (event === 'load') callback();
    return this;
  }
  addSource(id: string, source: { data: unknown }) {
    mapCalls.sources.push({ id, data: source.data });
  }
  addLayer(layer: { id: string }) {
    mapCalls.layers.push(layer.id);
  }
  getSource() {
    return { setData: (data: unknown) => mapCalls.data.push(data) };
  }
  fitBounds() {
    mapCalls.fits += 1;
  }
  remove() {
    mapCalls.removed += 1;
  }
}

export class Marker {
  setLngLat(point: [number, number]) {
    mapCalls.pins.push(point);
    return this;
  }
  addTo() {
    return this;
  }
  remove() {
    // nothing to clean up
  }
}
