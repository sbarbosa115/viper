import type { Clock } from '../../../../shared/domain/clock.js';
import { FixtureGeocoder } from '../../../../shared/infrastructure/geo/fixture-geocoder.js';
import { registerAdapter } from '../adapters/register.js';
import { ToolFailure, type RegisteredAdapter } from '../../application/tool-adapter.js';
import {
  domainSearchInput,
  domainSearchOutput,
  emailCheckInput,
  emailCheckOutput,
  geocodeInput,
  geocodeOutput,
  instagramInput,
  instagramOutput,
  mapsScrapeInput,
  mapsScrapeOutput,
  organizationInput,
  organizationOutput,
  overpassInput,
  overpassOutput,
  personInput,
  personOutput,
  phoneCheckInput,
  phoneCheckOutput,
  placesSearchInput,
  placesSearchOutput,
  scrapeInput,
  scrapeOutput,
  yelpInput,
  yelpOutput,
  type Place,
  type Source,
  type Verdict,
} from '../tool-io.js';
import { TOOL_KEYS } from '../../domain/tool-keys.js';
import { emailVerdict, toE164 } from '../adapters/verification.js';
import {
  distanceMeters,
  FAKE_BUSINESSES,
  fakeBusinessesOf,
  kindsForQuery,
  type FakeBusiness,
  type FakeKind,
} from './austin-businesses.js';
import type { FakeToolControls } from './fake-tool-controls.js';

const PAGE_SIZE = 20;

function numberOf(b: FakeBusiness): number {
  return FAKE_BUSINESSES.indexOf(b) + 1;
}

function bySlug(slug: string): FakeBusiness | undefined {
  return FAKE_BUSINESSES.find((b) => b.slug === slug);
}

function byDomain(domain: string): FakeBusiness | undefined {
  const match = /^(?:www\.)?([a-z0-9-]+)\.example$/.exec(domain.toLowerCase());
  return match?.[1] ? bySlug(match[1]) : undefined;
}

const CATEGORY: Record<FakeKind, string> = {
  bakery: 'Bakery',
  cafe: 'Cafe',
  dessert: 'Dessert shop',
  coffee: 'Coffee shop',
};

function googlePlace(b: FakeBusiness, sourceName: string, retrievedAt: string): Place {
  const url = `https://maps.google.example/?cid=${b.placeId}`;
  return {
    placeKey: `google:${b.placeId}`,
    name: b.name,
    address: b.address,
    lat: b.lat,
    lng: b.lng,
    category: CATEGORY[b.kind],
    categories: [b.kind, 'food', 'establishment'],
    phone: b.phone,
    website: b.website,
    rating: b.rating,
    reviewCount: b.reviews,
    mapsUrl: url,
    source: { name: sourceName, url, retrievedAt },
  };
}

function near(
  kinds: FakeKind[],
  center: { lat: number; lng: number },
  radiusMeters: number,
): FakeBusiness[] {
  return fakeBusinessesOf(kinds)
    .filter((b) => distanceMeters(center, b) <= radiusMeters)
    .sort(
      (a, b) =>
        distanceMeters(center, a) - distanceMeters(center, b) || a.slug.localeCompare(b.slug),
    );
}

/** Deterministic verification: business 7, 14, … have a bad email; 9, 18, … a dead phone. */
export function fakeEmailStatus(email: string): string {
  const lower = email.toLowerCase();
  if (lower.includes('invalid')) return 'invalid';
  if (lower.includes('unknown')) return 'unknown';
  const business = byDomain(lower.split('@')[1] ?? '');
  if (business && numberOf(business) % 7 === 0) return 'invalid';
  if (!business && !lower.endsWith('.example')) return 'catch-all';
  return 'valid';
}

export function fakePhoneValid(phone: string): boolean {
  const e164 = toE164(phone);
  if (!e164) return false;
  const match = /^\+1512555(01\d\d)$/.exec(e164);
  if (!match) return true;
  const n = Number(match[1]?.slice(2));
  return n % 9 !== 0;
}

function websiteMarkdown(b: FakeBusiness): string {
  const what: Record<FakeKind, string> = {
    bakery:
      'We bake sourdough, croissants, kolaches and celebration cakes from scratch every morning.',
    cafe: 'An all-day cafe with house-baked pastries, breakfast tacos and brunch plates.',
    dessert: 'Cupcakes, pies, pan dulce and custom dessert tables for weddings and events.',
    coffee: 'Single-origin coffee, roasted in small batches, with pastries from local bakers.',
  };
  return [
    `# ${b.name}`,
    '',
    what[b.kind],
    b.kind !== 'coffee'
      ? 'We go through about 200 lb of sugar a week and buy flour and sugar wholesale.'
      : '',
    '',
    '## Visit us',
    b.address,
    `Call ${b.phone}`,
    b.email ? `Email [${b.email}](mailto:${b.email})` : '',
    b.instagram ? `Follow us on [Instagram](https://www.instagram.com/${b.instagram}/)` : '',
    b.owner ? `Owned and run by ${b.owner}.` : '',
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');
}

/** Fixture-backed fakes for every non-Claude Tool (TOOLS_MODE=fake). Deterministic. */
export function createFakeAdapters(deps: {
  clock: Clock;
  controls: FakeToolControls;
}): RegisteredAdapter[] {
  const at = () => deps.clock.now().toISOString();
  const guard = async (key: string) => deps.controls.before(key);
  const geocoder = new FixtureGeocoder();
  const src = (name: string, url: string | null): Source => ({ name, url, retrievedAt: at() });

  return [
    registerAdapter({
      key: TOOL_KEYS.googlePlaces,
      requires: 'googleMaps',
      input: placesSearchInput,
      output: placesSearchOutput,
      maxUnits: () => 1,
      async run(input) {
        await guard(TOOL_KEYS.googlePlaces);
        const all = near(kindsForQuery(input.textQuery), input.center, input.radiusMeters);
        const start = input.pageToken?.startsWith('fake-page:')
          ? Number(input.pageToken.slice(10)) || 0
          : 0;
        const page = all.slice(start, start + PAGE_SIZE);
        const next = start + PAGE_SIZE < all.length ? `fake-page:${start + PAGE_SIZE}` : null;
        return {
          output: {
            places: page.map((b) => googlePlace(b, 'Google Maps', at())),
            nextPageToken: next,
          },
          units: 1,
        };
      },
    }),
    registerAdapter({
      key: TOOL_KEYS.googleGeocoding,
      requires: 'googleMaps',
      input: geocodeInput,
      output: geocodeOutput,
      maxUnits: () => 1,
      async run(input) {
        await guard(TOOL_KEYS.googleGeocoding);
        const hits = await geocoder.search(input.query, input.limit);
        return {
          output: {
            results: hits.map((h) => ({ label: h.label, lat: h.lat, lng: h.lng, placeId: null })),
            source: src('Google Geocoding', null),
          },
          units: 1,
        };
      },
    }),
    registerAdapter({
      key: TOOL_KEYS.apifyGoogleMaps,
      requires: 'apify',
      input: mapsScrapeInput,
      output: mapsScrapeOutput,
      maxUnits: (input) => input.maxItems,
      async run(input) {
        await guard(TOOL_KEYS.apifyGoogleMaps);
        const found = near(
          kindsForQuery(input.searchTerm),
          input.center,
          input.radiusKm * 1000,
        ).slice(0, input.maxItems);
        return {
          output: { places: found.map((b) => googlePlace(b, 'Google Maps (Apify)', at())) },
          units: found.length,
        };
      },
    }),
    registerAdapter({
      key: TOOL_KEYS.overpass,
      requires: null,
      input: overpassInput,
      output: overpassOutput,
      maxUnits: () => 1,
      async run(input) {
        await guard(TOOL_KEYS.overpass);
        const kinds = new Set<FakeKind>();
        for (const t of input.tags) {
          if (['bakery', 'pastry'].includes(t.value)) kinds.add('bakery');
          if (t.value === 'cafe') kinds.add('cafe');
          if (['coffee', 'cafe'].includes(t.value)) kinds.add('coffee');
          if (['confectionery', 'ice_cream', 'dessert'].includes(t.value)) kinds.add('dessert');
        }
        const found = near([...kinds], input.center, input.radiusMeters)
          .filter((b) => b.osm)
          .slice(0, input.limit);
        const places = found.map((b): Place => {
          const url = `https://www.openstreetmap.org/node/${9_000_000 + numberOf(b)}`;
          return {
            placeKey: `osm:node/${9_000_000 + numberOf(b)}`,
            name: b.name,
            address: b.address.replace(/, Austin, TX \d+$/, ', Austin'),
            lat: b.lat,
            lng: b.lng,
            category: b.kind === 'coffee' ? 'cafe' : b.kind,
            categories: [b.kind === 'bakery' ? 'shop=bakery' : 'amenity=cafe'],
            phone: numberOf(b) % 4 === 0 ? null : `+1 ${b.phone.replace(/-/g, ' ')}`,
            website: b.website,
            rating: null,
            reviewCount: null,
            mapsUrl: url,
            source: src('OpenStreetMap', url),
          };
        });
        return { output: { places }, units: 1 };
      },
    }),
    registerAdapter({
      key: TOOL_KEYS.firecrawl,
      requires: 'firecrawl',
      input: scrapeInput,
      output: scrapeOutput,
      maxUnits: () => 1,
      async run(input) {
        await guard(TOOL_KEYS.firecrawl);
        const business = byDomain(new URL(input.url).hostname);
        if (!business?.website)
          throw ToolFailure.final('Firecrawl answered HTTP 404: page not found');
        return {
          output: {
            url: input.url,
            title: `${business.name} | Austin, TX`,
            markdown: websiteMarkdown(business),
            statusCode: 200,
            source: src('Website', input.url),
          },
          units: 1,
        };
      },
    }),
    registerAdapter({
      key: TOOL_KEYS.apifyInstagram,
      requires: 'apify',
      input: instagramInput,
      output: instagramOutput,
      maxUnits: (input) => input.usernames.length,
      async run(input) {
        await guard(TOOL_KEYS.apifyInstagram);
        const found = input.usernames.flatMap((u) =>
          FAKE_BUSINESSES.filter((b) => b.instagram === u),
        );
        const profiles = found.map((b) => {
          const url = `https://www.instagram.com/${b.instagram}/`;
          return {
            username: b.instagram ?? '',
            fullName: b.name,
            bio: `${CATEGORY[b.kind]} in East Austin. Fresh every morning. ${b.phone}`,
            followers: 300 + ((numberOf(b) * 211) % 9_000),
            posts: 40 + ((numberOf(b) * 17) % 600),
            externalUrl: b.website,
            category: CATEGORY[b.kind],
            isBusiness: true,
            url,
            source: src('Instagram', url),
          };
        });
        return { output: { profiles }, units: profiles.length };
      },
    }),
    registerAdapter({
      key: TOOL_KEYS.apifyYelp,
      requires: 'apify',
      input: yelpInput,
      output: yelpOutput,
      maxUnits: (input) => input.maxItems,
      async run(input) {
        await guard(TOOL_KEYS.apifyYelp);
        const candidates = input.urls
          ? input.urls.flatMap((u) => {
              const slug = /\/biz\/([a-z0-9-]+)-austin\/?(?:[?#].*)?$/.exec(u)?.[1];
              const b = slug ? bySlug(slug) : undefined;
              return b ? [b] : [];
            })
          : fakeBusinessesOf(kindsForQuery(input.searchTerm ?? ''));
        const found = candidates.filter((b) => b.yelp).slice(0, input.maxItems);
        const businesses = found.map((b) => {
          const url = `https://www.yelp.com/biz/${b.slug}-austin`;
          return {
            yelpId: `fake-yelp-${b.slug}`,
            name: b.name,
            url,
            rating: Math.min(5, Math.round(b.rating * 2) / 2),
            reviewCount: Math.round(b.reviews * 0.6),
            categories: [CATEGORY[b.kind]],
            phone: `(512) 555-${b.phone.slice(-4)}`,
            website: b.website,
            address: b.address,
            reviewSnippets: [
              `Best ${b.kind === 'coffee' ? 'cold brew' : 'pastries'} on the east side.`,
              'They clearly bake everything in house.',
            ],
            source: src('Yelp', url),
          };
        });
        return { output: { businesses }, units: businesses.length };
      },
    }),
    registerAdapter({
      key: TOOL_KEYS.apolloOrganization,
      requires: 'apollo',
      input: organizationInput,
      output: organizationOutput,
      maxUnits: () => 1,
      async run(input) {
        await guard(TOOL_KEYS.apolloOrganization);
        const b = byDomain(input.domain);
        return {
          output: {
            organization: b
              ? {
                  name: b.name,
                  domain: input.domain,
                  website: b.website,
                  phone: b.phone,
                  industry: 'food & beverages',
                  employees: 4 + (numberOf(b) % 20),
                  description: `${CATEGORY[b.kind]} in Austin, TX.`,
                  city: 'Austin',
                  state: 'Texas',
                  linkedinUrl: null,
                  facebookUrl: null,
                }
              : null,
            source: src('Apollo', b?.website ?? null),
          },
          units: 1,
        };
      },
    }),
    registerAdapter({
      key: TOOL_KEYS.apolloPeople,
      requires: 'apollo',
      input: personInput,
      output: personOutput,
      maxUnits: () => 1,
      async run(input) {
        await guard(TOOL_KEYS.apolloPeople);
        const b = byDomain(input.domain);
        const owner = b?.owner ?? null;
        const first = owner?.split(' ')[0]?.toLowerCase();
        return {
          output: {
            person:
              b && owner
                ? {
                    name: owner,
                    title: 'Owner',
                    email: `${first}@${b.slug}.example`,
                    emailStatus: 'verified',
                    linkedinUrl: null,
                    organizationName: b.name,
                  }
                : null,
            source: src('Apollo', null),
          },
          units: 1,
        };
      },
    }),
    registerAdapter({
      key: TOOL_KEYS.hunter,
      requires: 'hunter',
      input: domainSearchInput,
      output: domainSearchOutput,
      maxUnits: () => 1,
      async run(input) {
        await guard(TOOL_KEYS.hunter);
        const b = byDomain(input.domain);
        const emails = [];
        if (b?.email) {
          emails.push({
            email: b.email,
            type: 'generic' as const,
            confidence: 92,
            firstName: null,
            lastName: null,
            position: null,
            sourceUrl: b.website,
          });
        }
        if (b?.owner && b.website) {
          const [first, last] = b.owner.split(' ');
          emails.push({
            email: `${first?.toLowerCase()}@${b.slug}.example`,
            type: 'personal' as const,
            confidence: 81,
            firstName: first ?? null,
            lastName: last ?? null,
            position: 'Owner',
            sourceUrl: b.website,
          });
        }
        return {
          output: {
            domain: input.domain,
            organization: b?.name ?? null,
            emails: emails.slice(0, input.limit),
            source: src('Hunter', `https://hunter.io/search/${input.domain}`),
          },
          units: 1,
        };
      },
    }),
    registerAdapter({
      key: TOOL_KEYS.zerobounce,
      requires: 'zerobounce',
      input: emailCheckInput,
      output: emailCheckOutput,
      maxUnits: () => 1,
      async run(input) {
        await guard(TOOL_KEYS.zerobounce);
        const status = fakeEmailStatus(input.email);
        return {
          output: {
            email: input.email,
            status,
            subStatus: status === 'invalid' ? 'mailbox_not_found' : null,
            verdict: emailVerdict(status),
            source: src('ZeroBounce', null),
          },
          units: 1,
        };
      },
    }),
    registerAdapter({
      key: TOOL_KEYS.twilioLookup,
      requires: 'twilio',
      input: phoneCheckInput,
      output: phoneCheckOutput,
      maxUnits: () => 1,
      async run(input) {
        await guard(TOOL_KEYS.twilioLookup);
        const valid = fakePhoneValid(input.phone);
        const verdict: Verdict = valid ? 'verified' : 'invalid';
        return {
          output: {
            phoneNumber: toE164(input.phone),
            valid,
            lineType: valid ? 'landline' : null,
            carrier: valid ? 'Fake Telecom' : null,
            verdict,
            source: src('Twilio Lookup', null),
          },
          units: 1,
        };
      },
    }),
  ];
}

/** Puts the fake error modes in front of any adapter (used for Claude in fake mode). */
export function withControls(
  adapter: RegisteredAdapter,
  controls: FakeToolControls,
): RegisteredAdapter {
  return {
    ...adapter,
    run: async (input) => {
      await controls.before(adapter.key);
      return adapter.run(input);
    },
  };
}
