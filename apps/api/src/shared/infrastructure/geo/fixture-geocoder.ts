import type { Geocoder, GeocodeResult } from '../../application/geocoder.js';

const places: readonly (GeocodeResult & { keys: readonly string[] })[] = [
  { keys: ['1200 e 6th st', 'sweet supply'], label: '1200 E 6th St, Austin, TX 78702', lat: 30.2624, lng: -97.7262, ambiguous: false },
  { keys: ['austin'], label: 'Austin, TX', lat: 30.2672, lng: -97.7431, ambiguous: false },
  { keys: ['fredericksburg'], label: 'Fredericksburg, TX', lat: 30.2752, lng: -98.8720, ambiguous: false },
  { keys: ['springfield'], label: 'Springfield, IL', lat: 39.7817, lng: -89.6501, ambiguous: true },
];

/** Deterministic geocoder for tests and TOOLS_MODE=fake. Unknown places return []. */
export class FixtureGeocoder implements Geocoder {
  search(query: string, limit = 5): Promise<readonly GeocodeResult[]> {
    const q = query.toLowerCase();
    const hits = places
      .filter((p) => p.keys.some((k) => q.includes(k)))
      .map(({ label, lat, lng, ambiguous }) => ({ label, lat, lng, ambiguous }));
    return Promise.resolve(hits.slice(0, limit));
  }
}
