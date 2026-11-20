import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, Map as MapGl, Marker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { copy, fill } from '../copy';
import { circleRing, ringBounds } from '../lib/circle';

const SOURCE = 'search-radius';

const style = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
} as const;

const data = (lat: number, lng: number, miles: number) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'Polygon' as const, coordinates: [circleRing(lat, lng, miles)] },
});

export interface MapPreviewProps {
  lat: number;
  lng: number;
  radiusMiles: number;
  label: string;
}

/** FR-17: the Search area on an OpenStreetMap raster map: a circle around a pin. */
export function MapPreview({ lat, lng, radiusMiles, label }: MapPreviewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapGl | null>(null);
  const pin = useRef<Marker | null>(null);
  const ready = useRef(false);
  const latest = useRef({ lat, lng, radiusMiles });
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    latest.current = { lat, lng, radiusMiles };
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { Map, Marker } = await import('maplibre-gl');
        if (cancelled || !container.current) return;
        const start = latest.current;
        const instance = new Map({
          container: container.current,
          style: style as never,
          center: [start.lng, start.lat],
          zoom: 10,
          interactive: false,
          attributionControl: { compact: true },
        });
        map.current = instance;
        pin.current = new Marker().setLngLat([start.lng, start.lat]).addTo(instance);
        instance.on('load', () => {
          const now = latest.current;
          instance.addSource(SOURCE, {
            type: 'geojson',
            data: data(now.lat, now.lng, now.radiusMiles),
          });
          instance.addLayer({
            id: `${SOURCE}-fill`,
            type: 'fill',
            source: SOURCE,
            paint: { 'fill-color': '#BEF264', 'fill-opacity': 0.15 },
          });
          instance.addLayer({
            id: `${SOURCE}-line`,
            type: 'line',
            source: SOURCE,
            paint: { 'line-color': '#BEF264', 'line-width': 2 },
          });
          ready.current = true;
          instance.fitBounds(ringBounds(circleRing(now.lat, now.lng, now.radiusMiles)), {
            padding: 24,
            animate: false,
          });
        });
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
      pin.current?.remove();
      map.current?.remove();
      map.current = null;
      pin.current = null;
      ready.current = false;
    };
  }, []);

  useEffect(() => {
    pin.current?.setLngLat([lng, lat]);
    const instance = map.current;
    if (!instance || !ready.current) return;
    void instance.getSource<GeoJSONSource>(SOURCE)?.setData(data(lat, lng, radiusMiles));
    instance.fitBounds(ringBounds(circleRing(lat, lng, radiusMiles)), {
      padding: 24,
      animate: false,
    });
  }, [lat, lng, radiusMiles]);

  if (unavailable) {
    return (
      <p className="m-0 rounded-row bg-sunken p-4 text-sm text-muted">{copy.mapUnavailable}</p>
    );
  }
  return (
    <div
      ref={container}
      role="img"
      aria-label={fill(copy.mapLabel, { n: radiusMiles, label })}
      className="h-56 w-full overflow-hidden rounded-row border border-line-strong bg-sunken"
    />
  );
}
