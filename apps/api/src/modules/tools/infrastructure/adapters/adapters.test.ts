import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, test } from 'vitest';
import { AnthropicLlmClient } from '../../../../shared/infrastructure/llm/anthropic-llm-client.js';
import { FixedClock } from '../../../../shared/infrastructure/time/system-clock.js';
import { ToolFailure, type RegisteredAdapter } from '../../application/tool-adapter.js';
import { FakeSettings, NOW, RecordingSleeper } from '../../test/fakes.js';
import { fixture, FixtureFetch } from '../../test/fixture-fetch.js';
import {
  apifyGoogleMapsAdapter,
  apifyInstagramAdapter,
  apifyYelpAdapter,
  APIFY_ACTORS,
  type ApifyActorRunner,
} from './apify.js';
import { claudeAdapter } from './claude.js';
import { apolloOrganizationAdapter, apolloPeopleAdapter, hunterAdapter } from './contacts.js';
import { firecrawlAdapter } from './firecrawl.js';
import {
  createGoogleGeocoder,
  googleGeocodingAdapter,
  googlePlacesAdapter,
  PLACES_FIELD_MASK,
} from './google.js';
import { overpassAdapter, overpassQuery } from './overpass.js';
import { toE164, twilioLookupAdapter, zeroBounceAdapter } from './verification.js';

const clock = new FixedClock(NOW);
const retrievedAt = NOW.toISOString();

async function invoke(adapter: RegisteredAdapter, raw: unknown) {
  const input = adapter.parseInput(raw);
  if (!input.ok) throw new Error(input.message);
  const result = await adapter.run(input.value);
  const output = adapter.parseOutput(result.output);
  if (!output.ok) throw new Error(`output: ${output.message}`);
  return { ...result, output: output.value as never, maxUnits: adapter.maxUnits(input.value) };
}

function http(f: FixtureFetch, settings = new FakeSettings()) {
  return { settings, clock, fetch: f.fetch };
}

class FixtureApify implements ApifyActorRunner {
  readonly runs: { actorId: string; input: Record<string, unknown>; maxItems: number }[] = [];
  constructor(private readonly items: unknown[]) {}
  run(actorId: string, input: Record<string, unknown>, maxItems: number): Promise<unknown[]> {
    this.runs.push({ actorId, input, maxItems });
    return Promise.resolve(this.items);
  }
}

const AUSTIN = { lat: 30.2624, lng: -97.7262 };

describe('FR-24: Google Places Text Search (New)', () => {
  test('normalises places with a Source, drops closed ones, 1 request', async () => {
    const f = new FixtureFetch().reply(200, fixture('google-places-text-search.json'));
    const result = await invoke(googlePlacesAdapter(http(f)), {
      textQuery: 'bakery',
      center: AUSTIN,
      radiusMeters: 4_828,
    });
    expect(result.units).toBe(1);
    expect(result.maxUnits).toBe(1);
    const output = result.output as { places: unknown[]; nextPageToken: string };
    expect(output.nextPageToken).toBe('AeCrKXsFixturePageToken2');
    expect(output.places).toHaveLength(2);
    expect(output.places[0]).toEqual({
      placeKey: 'google:ChIJfixture0001crumbco',
      name: 'Crumb & Co Bakery',
      address: '137 E 6th St, Austin, TX 78701, USA',
      lat: 30.267812,
      lng: -97.741203,
      category: 'Bakery',
      categories: ['bakery', 'cafe', 'food', 'store', 'point_of_interest', 'establishment'],
      phone: '(512) 555-0101',
      website: 'https://crumb-and-co-bakery.example/',
      rating: 4.6,
      reviewCount: 312,
      mapsUrl: 'https://maps.google.com/?cid=1000000000000000001',
      source: {
        name: 'Google Maps',
        url: 'https://maps.google.com/?cid=1000000000000000001',
        retrievedAt,
      },
    });
    const req = f.last();
    expect(req.method).toBe('POST');
    expect(req.headers['x-goog-api-key']).toBe('gmaps-key');
    expect(req.headers['x-goog-fieldmask']).toBe(PLACES_FIELD_MASK);
    expect(JSON.parse(req.body ?? '{}')).toEqual({
      textQuery: 'bakery',
      pageSize: 20,
      locationBias: {
        circle: { center: { latitude: 30.2624, longitude: -97.7262 }, radius: 4_828 },
      },
    });
  });

  test('429 is a retryable provider error with the provider message', async () => {
    const f = new FixtureFetch().reply(429, fixture('google-places-error.json'));
    const error = await invoke(googlePlacesAdapter(http(f)), {
      textQuery: 'x',
      center: AUSTIN,
      radiusMeters: 10,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolFailure);
    expect(error).toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
    expect((error as Error).message).toContain('Quota exceeded');
  });

  test('a network failure is retryable; 403 is not configured; 400 is final', async () => {
    const adapter = googlePlacesAdapter(
      http(
        new FixtureFetch()
          .networkError()
          .reply(403, { error: { message: 'API key not valid' } })
          .reply(400, {}),
      ),
    );
    const input = { textQuery: 'x', center: AUSTIN, radiusMeters: 10 };
    await expect(invoke(adapter, input)).rejects.toMatchObject({ retryable: true });
    await expect(invoke(adapter, input)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
      retryable: false,
    });
    await expect(invoke(adapter, input)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: false,
    });
  });
});

describe('FR-24: Google Geocoding', () => {
  test('normalises results, 1 request; the key goes only in the query string', async () => {
    const f = new FixtureFetch().reply(200, fixture('google-geocoding.json'));
    const result = await invoke(googleGeocodingAdapter(http(f)), {
      query: '1200 E 6th St, Austin',
    });
    expect(result.units).toBe(1);
    expect(result.output).toEqual({
      results: [
        {
          label: '1200 E 6th St, Austin, TX 78702, USA',
          lat: 30.2624,
          lng: -97.7262,
          placeId: 'ChIJfixtureGeocode1200E6th',
        },
      ],
      source: { name: 'Google Geocoding', url: null, retrievedAt },
    });
    expect(f.last().url).toContain('address=1200%20E%206th%20St%2C%20Austin');
    expect(f.last().url).toContain('key=gmaps-key');
  });

  test('REQUEST_DENIED (HTTP 200) is not configured, without the key in the message', async () => {
    const f = new FixtureFetch().reply(200, fixture('google-geocoding-denied.json'));
    const error = (await invoke(googleGeocodingAdapter(http(f)), { query: 'x' }).catch(
      (e: unknown) => e,
    )) as ToolFailure;
    expect(error.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(error.message).not.toContain('gmaps-key');
  });

  test('createGoogleGeocoder implements the Geocoder port', async () => {
    const f = new FixtureFetch()
      .reply(200, fixture('google-geocoding.json'))
      .reply(200, { results: [], status: 'ZERO_RESULTS' });
    const geocoder = createGoogleGeocoder(new FakeSettings(), { clock, fetch: f.fetch });
    expect(await geocoder.search('1200 E 6th St')).toEqual([
      {
        label: '1200 E 6th St, Austin, TX 78702, USA',
        lat: 30.2624,
        lng: -97.7262,
        ambiguous: false,
      },
    ]);
    expect(await geocoder.search('nowhere')).toEqual([]);
  });
});

describe('FR-24: Apify actors', () => {
  test('Google Maps scraper: places from the recorded items, 1 unit per item, item limit passed', async () => {
    const apify = new FixtureApify(fixture('apify-google-maps.json') as unknown[]);
    const result = await invoke(apifyGoogleMapsAdapter({ runner: apify, clock }), {
      searchTerm: 'bakery',
      center: AUSTIN,
      radiusKm: 4.8,
      maxItems: 25,
    });
    expect(result.units).toBe(3);
    expect(result.maxUnits).toBe(25);
    const places = (
      result.output as { places: { placeKey: string; name: string; website: string | null }[] }
    ).places;
    expect(places.map((p) => p.name)).toEqual(['Golden Crust Bakehouse', 'Little Oven Bakery']);
    expect(places[0]).toMatchObject({
      placeKey: 'google:ChIJfixture0003golden',
      category: 'Bakery',
      phone: '(512) 555-0103',
      rating: 4.7,
      reviewCount: 541,
      source: { name: 'Google Maps (Apify)', retrievedAt },
    });
    expect(apify.runs[0]).toEqual({
      actorId: APIFY_ACTORS.googleMaps,
      maxItems: 25,
      input: {
        searchStringsArray: ['bakery'],
        customGeolocation: { type: 'Point', coordinates: [-97.7262, 30.2624], radiusKm: 4.8 },
        maxCrawledPlacesPerSearch: 25,
        language: 'en',
        skipClosedPlaces: true,
      },
    });
  });

  test('Instagram profile scraper: profiles, 1 unit per profile', async () => {
    const apify = new FixtureApify(fixture('apify-instagram-profile.json') as unknown[]);
    const result = await invoke(apifyInstagramAdapter({ runner: apify, clock }), {
      usernames: ['@CrumbAndCoBakery'],
    });
    expect(apify.runs[0]?.input).toEqual({ usernames: ['crumbandcobakery'] });
    expect(result.units).toBe(1);
    expect(result.output).toEqual({
      profiles: [
        {
          username: 'crumbandcobakery',
          fullName: 'Crumb & Co Bakery',
          bio: 'Scratch bakery on East 6th. Sourdough, croissants, custom cakes. Open daily 7–3.',
          followers: 4821,
          posts: 377,
          externalUrl: 'https://crumb-and-co-bakery.example/',
          category: 'Bakery',
          isBusiness: true,
          url: 'https://www.instagram.com/crumbandcobakery',
          source: {
            name: 'Instagram',
            url: 'https://www.instagram.com/crumbandcobakery',
            retrievedAt,
          },
        },
      ],
    });
  });

  test('Yelp scraper: businesses with review snippets, 1 unit per business', async () => {
    const apify = new FixtureApify(fixture('apify-yelp.json') as unknown[]);
    const result = await invoke(apifyYelpAdapter({ runner: apify, clock }), {
      urls: ['https://www.yelp.com/biz/pecan-street-pastry-austin'],
    });
    expect(result.units).toBe(1);
    expect(apify.runs[0]?.input).toEqual({
      directUrls: ['https://www.yelp.com/biz/pecan-street-pastry-austin'],
      searchLimit: 10,
      reviewLimit: 3,
    });
    expect((result.output as { businesses: unknown[] }).businesses[0]).toEqual({
      yelpId: 'fixture-biz-0001',
      name: 'Pecan Street Pastry',
      url: 'https://www.yelp.com/biz/pecan-street-pastry-austin',
      rating: 4.5,
      reviewCount: 233,
      categories: ['Bakeries', 'Desserts'],
      phone: '(512) 555-0106',
      website: 'https://pecan-street-pastry.example',
      address: '322 E 11th St, Austin, TX 78701',
      reviewSnippets: [
        'The almond croissant is the best in town and they make everything in house.',
        'Great kolaches, a little pricey.',
      ],
      source: {
        name: 'Yelp',
        url: 'https://www.yelp.com/biz/pecan-street-pastry-austin',
        retrievedAt,
      },
    });
  });

  test('Yelp needs URLs or a search term and location', () => {
    const adapter = apifyYelpAdapter({ runner: new FixtureApify([]), clock });
    expect(adapter.parseInput({ searchTerm: 'bakery' }).ok).toBe(false);
  });
});

describe('FR-24: Overpass (OSM)', () => {
  test('normalises nodes and way centres, skips unnamed, 1 request', async () => {
    const f = new FixtureFetch().reply(200, fixture('overpass.json'));
    const sleeper = new RecordingSleeper();
    const result = await invoke(overpassAdapter({ clock, sleeper, fetch: f.fetch }), {
      center: AUSTIN,
      radiusMeters: 4_828,
      tags: [{ key: 'shop', value: 'bakery' }],
    });
    expect(result.units).toBe(1);
    const places = (result.output as { places: unknown[] }).places;
    expect(places).toEqual([
      {
        placeKey: 'osm:node/9000000008',
        name: 'Hill Country Kolaches',
        address: '396 Holly Street, Austin, TX 78702',
        lat: 30.2641,
        lng: -97.7311,
        category: 'bakery',
        categories: ['shop=bakery'],
        phone: '+1 512 555 0108',
        website: 'https://hill-country-kolaches.example',
        rating: null,
        reviewCount: null,
        mapsUrl: 'https://www.openstreetmap.org/node/9000000008',
        source: {
          name: 'OpenStreetMap',
          url: 'https://www.openstreetmap.org/node/9000000008',
          retrievedAt,
        },
      },
      expect.objectContaining({
        placeKey: 'osm:way/700000010',
        lat: 30.2588,
        lng: -97.7199,
        address: null,
      }),
    ]);
    expect(decodeURIComponent(f.last().body ?? '')).toContain(
      'nwr["shop"="bakery"](around:4828,30.2624,-97.7262);',
    );
  });

  test('throttles to 1 request per second', async () => {
    const f = new FixtureFetch().reply(200, { elements: [] }).reply(200, { elements: [] });
    const sleeper = new RecordingSleeper();
    const adapter = overpassAdapter({ clock, sleeper, fetch: f.fetch });
    const input = { center: AUSTIN, radiusMeters: 100, tags: [{ key: 'amenity', value: 'cafe' }] };
    await invoke(adapter, input);
    await invoke(adapter, input);
    expect(sleeper.waits).toEqual([1_000]);
  });

  test('the query asks for centres and the limit', () => {
    expect(
      overpassQuery({
        center: { lat: 1, lng: 2 },
        radiusMeters: 50.4,
        tags: [{ key: 'shop', value: 'pastry' }],
        limit: 7,
      }),
    ).toBe('[out:json][timeout:25];(nwr["shop"="pastry"](around:50,1,2););out center 7;');
  });

  test('rejects tag values that could inject Overpass QL', () => {
    const adapter = overpassAdapter({ clock, sleeper: new RecordingSleeper() });
    expect(
      adapter.parseInput({
        center: AUSTIN,
        radiusMeters: 1,
        tags: [{ key: 'shop', value: 'x"];out;' }],
      }).ok,
    ).toBe(false);
  });
});

describe('FR-24: Firecrawl scrape', () => {
  test('returns the page as Markdown with a Source, 1 page', async () => {
    const f = new FixtureFetch().reply(200, fixture('firecrawl-scrape.json'));
    const result = await invoke(firecrawlAdapter(http(f)), {
      url: 'https://crumb-and-co-bakery.example/',
    });
    expect(result.units).toBe(1);
    expect(result.output).toMatchObject({
      url: 'https://crumb-and-co-bakery.example/',
      title: 'Crumb & Co Bakery | Austin, TX',
      statusCode: 200,
      source: { name: 'Website', url: 'https://crumb-and-co-bakery.example/', retrievedAt },
    });
    expect((result.output as { markdown: string }).markdown).toContain(
      'hello@crumb-and-co-bakery.example',
    );
    expect(f.last().headers.authorization).toBe('Bearer fc-key');
    expect(JSON.parse(f.last().body ?? '{}')).toMatchObject({
      formats: ['markdown'],
      onlyMainContent: true,
    });
  });

  test('success:false is a final error', async () => {
    const f = new FixtureFetch().reply(200, { success: false, error: 'Blocked by robots.txt' });
    await expect(
      invoke(firecrawlAdapter(http(f)), { url: 'https://x.example/' }),
    ).rejects.toMatchObject({
      retryable: false,
    });
  });
});

describe('FR-24: Apollo and Hunter', () => {
  test('Apollo organization enrichment', async () => {
    const f = new FixtureFetch().reply(200, fixture('apollo-organization-enrich.json'));
    const result = await invoke(apolloOrganizationAdapter(http(f)), {
      domain: 'Golden-Crust-Bakehouse.example',
    });
    expect(result.units).toBe(1);
    expect(result.output).toEqual({
      organization: {
        name: 'Golden Crust Bakehouse',
        domain: 'golden-crust-bakehouse.example',
        website: 'http://www.golden-crust-bakehouse.example',
        phone: '+1 512-555-0103',
        industry: 'food & beverages',
        employees: 14,
        description: 'Golden Crust Bakehouse is a neighborhood bakery in Austin, Texas.',
        city: 'Austin',
        state: 'Texas',
        linkedinUrl: 'http://www.linkedin.com/company/golden-crust-fixture',
        facebookUrl: null,
      },
      source: { name: 'Apollo', url: 'http://www.golden-crust-bakehouse.example', retrievedAt },
    });
    expect(f.last().url).toBe(
      'https://api.apollo.io/api/v1/organizations/enrich?domain=golden-crust-bakehouse.example',
    );
    expect(f.last().headers['x-api-key']).toBe('apollo-key');
  });

  test('Apollo people enrichment asks for work emails only', async () => {
    const f = new FixtureFetch().reply(200, fixture('apollo-people-match.json'));
    const result = await invoke(apolloPeopleAdapter(http(f)), {
      domain: 'golden-crust-bakehouse.example',
      title: 'Owner',
    });
    expect(result.units).toBe(1);
    expect(result.output).toMatchObject({
      person: {
        name: 'Lena Park',
        title: 'Owner & Head Baker',
        email: 'lena@golden-crust-bakehouse.example',
        emailStatus: 'verified',
        organizationName: 'Golden Crust Bakehouse',
      },
      source: { name: 'Apollo', url: 'http://www.linkedin.com/in/lena-park-fixture', retrievedAt },
    });
    expect(JSON.parse(f.last().body ?? '{}')).toMatchObject({ reveal_personal_emails: false });
  });

  test('Apollo with no match returns null', async () => {
    const f = new FixtureFetch().reply(200, { person: null });
    const result = await invoke(apolloPeopleAdapter(http(f)), {
      domain: 'x.example',
      name: 'Nobody',
    });
    expect((result.output as { person: unknown }).person).toBeNull();
  });

  test('Hunter domain search', async () => {
    const f = new FixtureFetch().reply(200, fixture('hunter-domain-search.json'));
    const result = await invoke(hunterAdapter(http(f)), { domain: 'crumb-and-co-bakery.example' });
    expect(result.units).toBe(1);
    expect(result.output).toEqual({
      domain: 'crumb-and-co-bakery.example',
      organization: 'Crumb & Co Bakery',
      emails: [
        {
          email: 'hello@crumb-and-co-bakery.example',
          type: 'generic',
          confidence: 94,
          firstName: null,
          lastName: null,
          position: null,
          sourceUrl: 'http://crumb-and-co-bakery.example/contact',
        },
        {
          email: 'maya@crumb-and-co-bakery.example',
          type: 'personal',
          confidence: 88,
          firstName: 'Maya',
          lastName: 'Torres',
          position: 'Owner',
          sourceUrl: null,
        },
      ],
      source: {
        name: 'Hunter',
        url: 'https://hunter.io/search/crumb-and-co-bakery.example',
        retrievedAt,
      },
    });
  });
});

describe('FR-24: ZeroBounce and Twilio Lookup', () => {
  test('ZeroBounce valid → verified, 1 email', async () => {
    const f = new FixtureFetch().reply(200, fixture('zerobounce-validate.json'));
    const result = await invoke(zeroBounceAdapter(http(f)), {
      email: 'hello@crumb-and-co-bakery.example',
    });
    expect(result.units).toBe(1);
    expect(result.output).toEqual({
      email: 'hello@crumb-and-co-bakery.example',
      status: 'valid',
      subStatus: null,
      verdict: 'verified',
      source: { name: 'ZeroBounce', url: null, retrievedAt },
    });
  });

  test('ZeroBounce error body (HTTP 200) is not configured', async () => {
    const f = new FixtureFetch().reply(200, fixture('zerobounce-error.json'));
    await expect(
      invoke(zeroBounceAdapter(http(f)), { email: 'a@b.example' }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  });

  test('Twilio Lookup line type, 1 lookup, basic auth, E.164', async () => {
    const f = new FixtureFetch().reply(200, fixture('twilio-lookup.json'));
    const result = await invoke(twilioLookupAdapter(http(f)), { phone: '(512) 555-0101' });
    expect(result.units).toBe(1);
    expect(result.output).toEqual({
      phoneNumber: '+15125550101',
      valid: true,
      lineType: 'landline',
      carrier: 'Fixture Telecom - SVR',
      verdict: 'verified',
      source: { name: 'Twilio Lookup', url: null, retrievedAt },
    });
    expect(f.last().url).toBe(
      'https://lookups.twilio.com/v2/PhoneNumbers/%2B15125550101?Fields=line_type_intelligence',
    );
    expect(f.last().headers.authorization).toBe(
      `Basic ${Buffer.from('AC123:twilio-token').toString('base64')}`,
    );
  });

  test('E.164 normalisation', () => {
    expect(toE164('512-555-0101')).toBe('+15125550101');
    expect(toE164('1 (512) 555-0101')).toBe('+15125550101');
    expect(toE164('+44 20 7946 0000')).toBe('+442079460000');
    expect(toE164('555-0101')).toBeNull();
  });
});

describe('FR-24: Anthropic (Claude)', () => {
  function stubbedClaude() {
    const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const llm = new AnthropicLlmClient({
      settings: new FakeSettings(),
      createApi: () => ({
        create: (params) => {
          sent.push(params);
          return Promise.resolve(fixture('anthropic-message.json') as Anthropic.Message);
        },
      }),
    });
    return { sent, adapter: claudeAdapter('fast', { llm, clock }) };
  }

  test('metered by 1k tokens in on claude.fast and out on claude.fast.out', async () => {
    const { sent, adapter } = stubbedClaude();
    expect(adapter.key).toBe('claude.fast');
    const result = await invoke(adapter, {
      system: 'You write search terms.',
      messages: [{ role: 'user', content: 'Bakeries near Austin' }],
      purpose: 'research.search-terms',
      maxTokens: 2_000,
    });
    expect(sent[0]?.model).toBe('claude-haiku-5-5');
    expect(result.units).toBe(2);
    expect(result.meters).toEqual([{ toolKey: 'claude.fast.out', units: 1 }]);
    const maxInput = {
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
      purpose: 'p',
      maxTokens: 2_000,
    };
    expect(adapter.maxMeters(maxInput)).toEqual([{ toolKey: 'claude.fast.out', units: 2 }]);
    expect(result.output).toEqual({
      text: 'Here are the search terms.',
      toolCall: {
        name: 'search_terms',
        input: { terms: ['bakery', 'pastry shop', 'cafe that bakes'] },
      },
      usage: { inputTokens: 1850, outputTokens: 120 },
      model: 'claude-haiku-5-5',
      source: { name: 'Claude', url: null, retrievedAt },
    });
  });
});
