const EARTH_RADIUS_M = 6_371_008.8;
const METRES_PER_MILE = 1609.344;

/** A closed ring of lng/lat points approximating a circle of `radiusMiles` around a point. */
export function circleRing(
  lat: number,
  lng: number,
  radiusMiles: number,
  steps = 64,
): [number, number][] {
  const d = (radiusMiles * METRES_PER_MILE) / EARTH_RADIUS_M;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * (i % steps)) / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
      );
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return ring;
}

export function ringBounds(ring: [number, number][]): [[number, number], [number, number]] {
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
