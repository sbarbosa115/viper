import type { Geocoder, GeocodeResult } from '../../../../shared/application/geocoder.js';
import type { Clock } from '../../../../shared/domain/clock.js';
import { SystemClock } from '../../../../shared/infrastructure/time/system-clock.js';
import type { ProviderSettings } from '../../application/ports.js';
import { registerAdapter } from './register.js';
import { ToolFailure, type RegisteredAdapter } from '../../application/tool-adapter.js';
import {
  geocodeInput,
  geocodeOutput,
  placesSearchInput,
  placesSearchOutput,
  type GeocodeInput,
  type GeocodeOutput,
  type Place,
  type PlacesSearchInput,
} from '../tool-io.js';
import { TOOL_KEYS } from '../../domain/tool-keys.js';
import { requestJson, requireKey, type Fetch } from './http.js';

const PROVIDER = 'Google Maps Platform';
export const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
export const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** The fields we pay for (Text Search Enterprise SKU: phone, website, rating). */
export const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.businessStatus',
  'nextPageToken',
].join(',');

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
}

interface Deps {
  settings: ProviderSettings;
  clock: Clock;
  fetch?: Fetch;
}

function toPlace(p: GooglePlace, retrievedAt: string): Place | null {
  const name = p.displayName?.text;
  const lat = p.location?.latitude;
  const lng = p.location?.longitude;
  if (!p.id || !name || lat === undefined || lng === undefined) return null;
  return {
    placeKey: `google:${p.id}`,
    name,
    address: p.formattedAddress ?? null,
    lat,
    lng,
    category: p.primaryTypeDisplayName?.text ?? p.primaryType ?? null,
    categories: p.types ?? [],
    phone: p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
    mapsUrl: p.googleMapsUri ?? null,
    source: { name: 'Google Maps', url: p.googleMapsUri ?? null, retrievedAt },
  };
}

/** Google Places Text Search (New): one page of up to 20 places in a circle (1 request). */
export function googlePlacesAdapter(deps: Deps): RegisteredAdapter {
  const fetchFn = deps.fetch ?? fetch;
  return registerAdapter({
    key: TOOL_KEYS.googlePlaces,
    requires: 'googleMaps',
    input: placesSearchInput,
    output: placesSearchOutput,
    maxUnits: () => 1,
    async run(input: PlacesSearchInput) {
      const apiKey = requireKey((await deps.settings.provider('googleMaps')).apiKey, PROVIDER);
      const body = (await requestJson(fetchFn, PROVIDER, PLACES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': PLACES_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: input.textQuery,
          pageSize: 20,
          locationBias: {
            circle: {
              center: { latitude: input.center.lat, longitude: input.center.lng },
              radius: input.radiusMeters,
            },
          },
          ...(input.pageToken ? { pageToken: input.pageToken } : {}),
        }),
      })) as { places?: GooglePlace[]; nextPageToken?: string } | null;
      const retrievedAt = deps.clock.now().toISOString();
      const places = (body?.places ?? [])
        .filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY')
        .map((p) => toPlace(p, retrievedAt))
        .filter((p): p is Place => p !== null);
      return { output: { places, nextPageToken: body?.nextPageToken ?? null }, units: 1 };
    },
  });
}

interface GeocodeBody {
  status?: string;
  error_message?: string;
  results?: {
    formatted_address?: string;
    place_id?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }[];
}

/** Geocoding API statuses (https://developers.google.com/maps/documentation/geocoding). */
function geocodeFailure(status: string, message: string | undefined): ToolFailure {
  const text = `Google Geocoding: ${status}${message ? ` (${message})` : ''}`;
  if (status === 'OVER_QUERY_LIMIT' || status === 'UNKNOWN_ERROR')
    return ToolFailure.retryable(text);
  if (status === 'REQUEST_DENIED') return ToolFailure.notConfigured(text);
  return ToolFailure.final(text);
}

async function geocode(deps: Deps, input: GeocodeInput): Promise<GeocodeOutput> {
  const fetchFn = deps.fetch ?? fetch;
  const apiKey = requireKey((await deps.settings.provider('googleMaps')).apiKey, PROVIDER);
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(input.query)}&key=${encodeURIComponent(apiKey)}`;
  const body = (await requestJson(fetchFn, PROVIDER, url)) as GeocodeBody | null;
  const status = body?.status ?? 'UNKNOWN_ERROR';
  if (status !== 'OK' && status !== 'ZERO_RESULTS')
    throw geocodeFailure(status, body?.error_message);
  const results = (body?.results ?? []).flatMap((r) => {
    const lat = r.geometry?.location?.lat;
    const lng = r.geometry?.location?.lng;
    if (!r.formatted_address || lat === undefined || lng === undefined) return [];
    return [{ label: r.formatted_address, lat, lng, placeId: r.place_id ?? null }];
  });
  return {
    results: results.slice(0, input.limit),
    source: { name: 'Google Geocoding', url: null, retrievedAt: deps.clock.now().toISOString() },
  };
}

/** Google Geocoding: an address or place name to points (1 request). */
export function googleGeocodingAdapter(deps: Deps): RegisteredAdapter {
  return registerAdapter({
    key: TOOL_KEYS.googleGeocoding,
    requires: 'googleMaps',
    input: geocodeInput,
    output: geocodeOutput,
    maxUnits: () => 1,
    run: async (input: GeocodeInput) => ({ output: await geocode(deps, input), units: 1 }),
  });
}

/**
 * The shared Geocoder port on Google Geocoding (profile, planning, assistant). Not metered: those
 * calls are not part of a run. Provider failures surface as errors to the caller.
 */
export function createGoogleGeocoder(
  settings: ProviderSettings,
  options: { clock?: Clock; fetch?: Fetch } = {},
): Geocoder {
  const deps: Deps = {
    settings,
    clock: options.clock ?? new SystemClock(),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
  return {
    async search(query: string, limit = 5): Promise<readonly GeocodeResult[]> {
      const { results } = await geocode(
        deps,
        geocodeInput.parse({ query, limit: Math.min(Math.max(limit, 1), 10) }),
      );
      return results.map((r) => ({
        label: r.label,
        lat: r.lat,
        lng: r.lng,
        ambiguous: results.length > 1,
      }));
    },
  };
}
