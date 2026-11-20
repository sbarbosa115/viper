import { ApifyApiError, ApifyClient } from 'apify-client';
import type { Clock } from '../../../../shared/domain/clock.js';
import type { ProviderSettings } from '../../application/ports.js';
import { registerAdapter } from './register.js';
import { ToolFailure, type RegisteredAdapter } from '../../application/tool-adapter.js';
import {
  instagramInput,
  instagramOutput,
  mapsScrapeInput,
  mapsScrapeOutput,
  yelpInput,
  yelpOutput,
  type InstagramOutput,
  type MapsScrapeInput,
  type Place,
  type YelpOutput,
} from '../tool-io.js';
import { TOOL_KEYS } from '../../domain/tool-keys.js';
import { failureFor, requireKey } from './http.js';

/**
 * Apify actors (proposed; founder approves, PRD section 14). Pay-per-result actors, so the item
 * limit caps the cost: 1 unit per item returned.
 */
export const APIFY_ACTORS = {
  googleMaps: 'compass/crawler-google-places',
  instagram: 'apify/instagram-profile-scraper',
  yelp: 'tri_angle/yelp-scraper',
} as const;

const PROVIDER = 'Apify';
/** How long a run-sync call waits for the actor (one try; see LONGEST_TRY_MS). */
export const APIFY_WAIT_SECS = 240;

/** Runs an actor synchronously and returns at most `maxItems` dataset items. */
export interface ApifyActorRunner {
  run(actorId: string, input: Record<string, unknown>, maxItems: number): Promise<unknown[]>;
}

/** The live runner on apify-client: `actor.call` (waits for the run) then the dataset items. */
export function apifyClientRunner(settings: ProviderSettings): ApifyActorRunner {
  return {
    async run(actorId, input, maxItems) {
      const token = requireKey((await settings.provider('apify')).apiKey, PROVIDER);
      const client = new ApifyClient({ token, maxRetries: 0 });
      try {
        const run = await client
          .actor(actorId)
          .call(input, { maxItems, waitSecs: APIFY_WAIT_SECS });
        if (run.status !== 'SUCCEEDED') {
          throw ToolFailure.retryable(`Apify actor ${actorId} ended ${run.status}`);
        }
        const { items } = await client
          .dataset(run.defaultDatasetId)
          .listItems({ limit: maxItems, clean: true });
        return items;
      } catch (error) {
        if (error instanceof ToolFailure) throw error;
        if (error instanceof ApifyApiError)
          throw failureFor(PROVIDER, error.statusCode, { message: error.message });
        throw ToolFailure.retryable(`Apify could not be reached`);
      }
    },
  };
}

interface Deps {
  runner: ApifyActorRunner;
  clock: Clock;
}

type Item = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
const obj = (v: unknown): Item => (typeof v === 'object' && v !== null ? (v as Item) : {});

/** compass/crawler-google-places item → Place. */
export function mapsItemToPlace(item: Item, retrievedAt: string): Place | null {
  const name = str(item.title);
  const location = obj(item.location);
  const lat = num(location.lat);
  const lng = num(location.lng);
  const id = str(item.placeId);
  if (!name || lat === null || lng === null || !id) return null;
  if (item.permanentlyClosed === true) return null;
  const url = str(item.url);
  return {
    placeKey: `google:${id}`,
    name,
    address: str(item.address),
    lat,
    lng,
    category: str(item.categoryName),
    categories: strings(item.categories),
    phone: str(item.phone),
    website: str(item.website),
    rating: num(item.totalScore),
    reviewCount: int(item.reviewsCount),
    mapsUrl: url,
    source: { name: 'Google Maps (Apify)', url, retrievedAt },
  };
}

/** Apify Google Maps scraper: places for a search term around a point. */
export function apifyGoogleMapsAdapter(deps: Deps): RegisteredAdapter {
  return registerAdapter({
    key: TOOL_KEYS.apifyGoogleMaps,
    requires: 'apify',
    input: mapsScrapeInput,
    output: mapsScrapeOutput,
    maxUnits: (input: MapsScrapeInput) => input.maxItems,
    async run(input: MapsScrapeInput) {
      const items = await deps.runner.run(
        APIFY_ACTORS.googleMaps,
        {
          searchStringsArray: [input.searchTerm],
          customGeolocation: {
            type: 'Point',
            coordinates: [input.center.lng, input.center.lat],
            radiusKm: input.radiusKm,
          },
          maxCrawledPlacesPerSearch: input.maxItems,
          language: 'en',
          skipClosedPlaces: true,
        },
        input.maxItems,
      );
      const retrievedAt = deps.clock.now().toISOString();
      const kept = items.slice(0, input.maxItems);
      const places = kept
        .map((i) => mapsItemToPlace(obj(i), retrievedAt))
        .filter((p): p is Place => p !== null);
      return { output: { places }, units: kept.length };
    },
  });
}

/** apify/instagram-profile-scraper: public business profiles by username. */
export function apifyInstagramAdapter(deps: Deps): RegisteredAdapter {
  return registerAdapter({
    key: TOOL_KEYS.apifyInstagram,
    requires: 'apify',
    input: instagramInput,
    output: instagramOutput,
    maxUnits: (input: { usernames: string[] }) => input.usernames.length,
    async run(input: { usernames: string[] }) {
      const max = input.usernames.length;
      const items = (
        await deps.runner.run(APIFY_ACTORS.instagram, { usernames: input.usernames }, max)
      ).slice(0, max);
      const retrievedAt = deps.clock.now().toISOString();
      const profiles: InstagramOutput['profiles'] = items.flatMap((raw) => {
        const i = obj(raw);
        const username = str(i.username);
        if (!username) return [];
        const url = str(i.url) ?? `https://www.instagram.com/${username}/`;
        return [
          {
            username,
            fullName: str(i.fullName),
            bio: str(i.biography),
            followers: int(i.followersCount),
            posts: int(i.postsCount),
            externalUrl: str(i.externalUrl),
            category: str(i.businessCategoryName),
            isBusiness: i.isBusinessAccount === true,
            url,
            source: { name: 'Instagram', url, retrievedAt },
          },
        ];
      });
      return { output: { profiles }, units: items.length };
    },
  });
}

interface YelpParsed {
  searchTerm?: string | undefined;
  location?: string | undefined;
  urls?: string[] | undefined;
  maxItems: number;
}

/** tri_angle/yelp-scraper: businesses with rating and a few review snippets. */
export function apifyYelpAdapter(deps: Deps): RegisteredAdapter {
  return registerAdapter({
    key: TOOL_KEYS.apifyYelp,
    requires: 'apify',
    input: yelpInput,
    output: yelpOutput,
    maxUnits: (input: YelpParsed) => input.maxItems,
    async run(input: YelpParsed) {
      const actorInput: Record<string, unknown> = input.urls
        ? { directUrls: input.urls }
        : { searchTerms: [input.searchTerm], locations: [input.location] };
      const items = (
        await deps.runner.run(
          APIFY_ACTORS.yelp,
          { ...actorInput, searchLimit: input.maxItems, reviewLimit: 3 },
          input.maxItems,
        )
      ).slice(0, input.maxItems);
      const retrievedAt = deps.clock.now().toISOString();
      const businesses: YelpOutput['businesses'] = items.flatMap((raw) => {
        const i = obj(raw);
        const name = str(i.name);
        const url = str(i.directUrl) ?? str(i.url);
        const id = str(i.bizId) ?? url;
        if (!name || !url || !id) return [];
        const address = obj(i.address);
        const reviews = Array.isArray(i.reviews) ? i.reviews : [];
        return [
          {
            yelpId: id,
            name,
            url,
            rating: num(i.aggregatedRating) ?? num(i.rating),
            reviewCount: int(i.reviewCount),
            categories: strings(i.categories),
            phone: str(i.phone),
            website: str(i.website),
            address: str(address.formattedAddress) ?? str(i.address),
            reviewSnippets: reviews
              .map((r) => str(obj(r).text))
              .filter((t): t is string => t !== null)
              .map((t) => t.slice(0, 300))
              .slice(0, 3),
            source: { name: 'Yelp', url, retrievedAt },
          },
        ];
      });
      return { output: { businesses }, units: items.length };
    },
  });
}
