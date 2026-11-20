import type { Clock } from '../../../../shared/domain/clock.js';
import type { Sleeper } from '../../application/ports.js';
import { registerAdapter } from './register.js';
import { type RegisteredAdapter } from '../../application/tool-adapter.js';
import { overpassInput, overpassOutput, type Place } from '../tool-io.js';
import { TOOL_KEYS } from '../../domain/tool-keys.js';
import { requestJson, type Fetch } from './http.js';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** The public endpoint's fair-use rule: at most 1 request per second. */
export const OVERPASS_MIN_INTERVAL_MS = 1_000;

interface Parsed {
  center: { lat: number; lng: number };
  radiusMeters: number;
  tags: { key: string; value: string }[];
  limit: number;
}

interface Element {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/** Overpass QL: nodes, ways and relations with any of the tags around the point, centres only. */
export function overpassQuery(input: Parsed): string {
  const around = `(around:${Math.round(input.radiusMeters)},${input.center.lat},${input.center.lng})`;
  const selectors = input.tags.map((t) => `nwr["${t.key}"="${t.value}"]${around};`).join('');
  return `[out:json][timeout:25];(${selectors});out center ${input.limit};`;
}

function address(tags: Record<string, string>): string | null {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const parts = [
    street,
    tags['addr:city'],
    [tags['addr:state'], tags['addr:postcode']].filter(Boolean).join(' '),
  ]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(', ') : null;
}

const CATEGORY_TAGS = ['shop', 'amenity', 'craft', 'cuisine'] as const;

export function elementToPlace(e: Element, retrievedAt: string): Place | null {
  const tags = e.tags ?? {};
  const name = tags.name;
  const lat = e.lat ?? e.center?.lat;
  const lng = e.lon ?? e.center?.lon;
  if (!name || !e.type || e.id === undefined || lat === undefined || lng === undefined) return null;
  const categories = CATEGORY_TAGS.flatMap((k) => (tags[k] ? [`${k}=${tags[k]}`] : []));
  const url = `https://www.openstreetmap.org/${e.type}/${e.id}`;
  return {
    placeKey: `osm:${e.type}/${e.id}`,
    name,
    address: address(tags),
    lat,
    lng,
    category: tags.shop ?? tags.amenity ?? tags.craft ?? null,
    categories,
    phone: tags.phone ?? tags['contact:phone'] ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
    rating: null,
    reviewCount: null,
    mapsUrl: url,
    source: { name: 'OpenStreetMap', url, retrievedAt },
  };
}

/** Overpass (OSM, public endpoint, no key), throttled to 1 request per second per process. */
export function overpassAdapter(deps: {
  clock: Clock;
  sleeper: Sleeper;
  fetch?: Fetch;
  url?: string;
}): RegisteredAdapter {
  const fetchFn = deps.fetch ?? fetch;
  let last = Number.NEGATIVE_INFINITY;
  async function throttle(): Promise<void> {
    const wait = last + OVERPASS_MIN_INTERVAL_MS - deps.clock.now().getTime();
    if (wait > 0) await deps.sleeper.sleep(wait);
    last = deps.clock.now().getTime();
  }
  return registerAdapter({
    key: TOOL_KEYS.overpass,
    requires: null,
    input: overpassInput,
    output: overpassOutput,
    maxUnits: () => 1,
    async run(input: Parsed) {
      await throttle();
      const body = (await requestJson(fetchFn, 'Overpass', deps.url ?? OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: overpassQuery(input) }).toString(),
      })) as { elements?: Element[] } | null;
      const retrievedAt = deps.clock.now().toISOString();
      const places = (body?.elements ?? [])
        .map((e) => elementToPlace(e, retrievedAt))
        .filter((p): p is Place => p !== null)
        .slice(0, input.limit);
      return { output: { places }, units: 1 };
    },
  });
}
