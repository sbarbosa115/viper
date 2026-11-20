import { describe, expect, test } from 'vitest';
import { FixedClock } from '../../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../../shared/infrastructure/time/uuid7.js';
import { ScriptedLlmClient } from '../../../../shared/infrastructure/llm/scripted-llm-client.js';
import { ToolRunner } from '../../application/tool-runner.js';
import type { Place } from '../tool-io.js';
import { TOOL_KEYS } from '../../domain/tool-keys.js';
import {
  BUSINESS,
  catalogSnapshots,
  FakeSettings,
  InMemoryToolCallRepository,
  InMemoryToolRepository,
  NOW,
  RecordingSleeper,
  RUN,
} from '../../test/fakes.js';
import { createFakeAdapterRegistry } from '../adapters/index.js';
import { CENTER, FAKE_BUSINESSES, fakeBusinessesOf } from './austin-businesses.js';
import { FakeToolControls, InMemoryFaultStore } from './fake-tool-controls.js';

function fakeRunner() {
  const controls = new FakeToolControls(new InMemoryFaultStore(), new RecordingSleeper());
  const sleeper = new RecordingSleeper();
  const clock = new FixedClock(NOW);
  const llm = new ScriptedLlmClient(() => ({
    text: 'ok',
    usage: { inputTokens: 1_200, outputTokens: 300 },
    model: 'claude-haiku-5-5',
  }));
  const calls = new InMemoryToolCallRepository();
  const runner = new ToolRunner<never>({
    tools: new InMemoryToolRepository(catalogSnapshots()),
    calls: () => calls,
    adapters: createFakeAdapterRegistry({
      settings: new FakeSettings(),
      clock,
      sleeper,
      llm,
      controls,
    }),
    settings: new FakeSettings(),
    clock,
    ids: new SequentialIdGenerator(),
    sleeper,
  });
  let step = 0;
  const call = (toolKey: string, input: unknown) =>
    runner.call({
      businessId: BUSINESS,
      runId: RUN,
      stepKey: `s${step++}`,
      attemptN: 1,
      toolKey,
      input,
    });
  return { controls, sleeper, calls, call };
}

const THREE_MILES = 4_828;

describe('PRD 11: fake Tool fixtures', () => {
  test('30 bakeries, cafés and dessert shops and 10 coffee shops, invented and near Sweet Supply', () => {
    expect(fakeBusinessesOf(['bakery', 'cafe', 'dessert'])).toHaveLength(30);
    expect(fakeBusinessesOf(['coffee'])).toHaveLength(10);
    for (const b of FAKE_BUSINESSES) {
      expect(b.phone).toMatch(/^512-555-01\d\d$/);
      if (b.website) expect(b.website).toMatch(/^https:\/\/[a-z0-9-]+\.example$/);
      if (b.email) expect(b.email).toMatch(/@[a-z0-9-]+\.example$/);
      expect(Math.abs(b.lat - CENTER.lat)).toBeLessThan(0.045);
    }
    expect(new Set(FAKE_BUSINESSES.map((b) => b.placeId)).size).toBe(40);
    expect(FAKE_BUSINESSES.filter((b) => b.instagram).length).toBeGreaterThan(10);
    expect(FAKE_BUSINESSES.filter((b) => b.email).length).toBeGreaterThan(10);
  });

  test('Places: bakeries in two pages of 20 + 10, deterministic; coffee terms give coffee shops', async () => {
    const f = fakeRunner();
    const input = { textQuery: 'bakery', center: CENTER, radiusMeters: THREE_MILES };
    const first = await f.call(TOOL_KEYS.googlePlaces, input);
    const page1 = first.output as { places: Place[]; nextPageToken: string };
    expect(page1.places).toHaveLength(20);
    const second = await f.call(TOOL_KEYS.googlePlaces, {
      ...input,
      pageToken: page1.nextPageToken,
    });
    const page2 = second.output as { places: Place[]; nextPageToken: string | null };
    expect(page2.places).toHaveLength(10);
    expect(page2.nextPageToken).toBeNull();
    expect(page1.places[0]?.source.name).toBe('Google Maps');
    const again = await f.call(TOOL_KEYS.googlePlaces, input);
    expect(again.output).toEqual(first.output);
    const coffee = await f.call(TOOL_KEYS.googlePlaces, { ...input, textQuery: 'coffee shop' });
    expect((coffee.output as { places: Place[] }).places).toHaveLength(10);
  });

  test('Apify Maps shares Google place keys; OSM returns a subset with its own keys', async () => {
    const f = fakeRunner();
    const maps = await f.call(TOOL_KEYS.apifyGoogleMaps, {
      searchTerm: 'bakery',
      center: CENTER,
      radiusKm: 4.8,
      maxItems: 25,
    });
    expect(maps.units).toBe(25);
    expect((maps.output as { places: Place[] }).places[0]?.placeKey).toMatch(/^google:ChIJfake/);
    const osm = await f.call(TOOL_KEYS.overpass, {
      center: CENTER,
      radiusMeters: THREE_MILES,
      tags: [
        { key: 'shop', value: 'bakery' },
        { key: 'amenity', value: 'cafe' },
        { key: 'shop', value: 'confectionery' },
      ],
    });
    const osmPlaces = (osm.output as { places: Place[] }).places;
    expect(osmPlaces.length).toBeGreaterThan(5);
    expect(osmPlaces.every((p) => p.placeKey.startsWith('osm:node/'))).toBe(true);
  });

  test('websites, socials and contacts for a fixture business', async () => {
    const f = fakeRunner();
    const crumb = FAKE_BUSINESSES[0];
    if (!crumb?.website || !crumb.instagram) throw new Error('fixture changed');
    const page = await f.call(TOOL_KEYS.firecrawl, { url: crumb.website });
    expect((page.output as { markdown: string }).markdown).toContain(crumb.phone);
    const missing = await f.call(TOOL_KEYS.firecrawl, { url: 'https://nobody.example' });
    expect(missing.error).toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
    const ig = await f.call(TOOL_KEYS.apifyInstagram, {
      usernames: [crumb.instagram, 'unknown_handle'],
    });
    expect(ig.units).toBe(1);
    const yelp = await f.call(TOOL_KEYS.apifyYelp, {
      urls: [`https://www.yelp.com/biz/${crumb.slug}-austin`],
    });
    expect((yelp.output as { businesses: unknown[] }).businesses).toHaveLength(1);
    const domain = `${crumb.slug}.example`;
    const hunter = await f.call(TOOL_KEYS.hunter, { domain });
    expect((hunter.output as { emails: { email: string }[] }).emails.map((e) => e.email)).toEqual([
      `hello@${domain}`,
      `maya@${domain}`,
    ]);
    const org = await f.call(TOOL_KEYS.apolloOrganization, { domain });
    expect((org.output as { organization: { name: string } }).organization.name).toBe(crumb.name);
    const person = await f.call(TOOL_KEYS.apolloPeople, { domain, title: 'Owner' });
    expect((person.output as { person: { name: string } }).person.name).toBe('Maya Torres');
  });

  test('verification is deterministic: most valid, some invalid', async () => {
    const f = fakeRunner();
    const verdicts = [];
    for (const b of FAKE_BUSINESSES) {
      if (b.email)
        verdicts.push(
          ((await f.call(TOOL_KEYS.zerobounce, { email: b.email })).output as { verdict: string })
            .verdict,
        );
    }
    expect(verdicts.filter((v) => v === 'invalid').length).toBeGreaterThan(0);
    expect(verdicts.filter((v) => v === 'verified').length).toBeGreaterThan(verdicts.length / 2);
    const phones = [];
    for (const b of FAKE_BUSINESSES) {
      phones.push(
        ((await f.call(TOOL_KEYS.twilioLookup, { phone: b.phone })).output as { verdict: string })
          .verdict,
      );
    }
    expect(phones.filter((v) => v === 'invalid')).toHaveLength(4);
  });

  test('Claude in fake mode runs the scripted LLM and meters tokens', async () => {
    const f = fakeRunner();
    const result = await f.call(TOOL_KEYS.claudeFast, {
      system: 's',
      messages: [{ role: 'user', content: 'terms' }],
      purpose: 'research.search-terms',
    });
    expect(result).toMatchObject({ status: 'ok', units: 2, millicredits: 2 * 30 + 1 * 150 });
  });
});

describe('AJ-5: fake error modes', () => {
  test('failAlways: every attempt fails with a retryable provider error', async () => {
    const f = fakeRunner();
    await f.controls.failAlways(TOOL_KEYS.googlePlaces);
    const result = await f.call(TOOL_KEYS.googlePlaces, {
      textQuery: 'bakery',
      center: CENTER,
      radiusMeters: 100,
    });
    expect(result.error).toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
    expect(f.sleeper.waits).toEqual([1_000, 4_000, 16_000]);
  });

  test('failNext(n) fails n calls then recovers; reset clears every mode', async () => {
    const f = fakeRunner();
    await f.controls.failNext(TOOL_KEYS.zerobounce, 2);
    const result = await f.call(TOOL_KEYS.zerobounce, { email: 'a@b.example' });
    expect(result.status).toBe('ok');
    expect(f.sleeper.waits).toEqual([1_000, 4_000]);
    await f.controls.failAlways(TOOL_KEYS.hunter);
    await f.controls.reset();
    expect((await f.call(TOOL_KEYS.hunter, { domain: 'a.example' })).status).toBe('ok');
  });

  test('stall delays the call', async () => {
    const controls = new FakeToolControls(new InMemoryFaultStore(), new RecordingSleeper());
    const sleeper = new RecordingSleeper();
    const stalling = new FakeToolControls(new InMemoryFaultStore(), sleeper);
    await stalling.stall(TOOL_KEYS.firecrawl, 5_000);
    await stalling.before(TOOL_KEYS.firecrawl);
    expect(sleeper.waits).toEqual([5_000]);
    await expect(controls.before(TOOL_KEYS.firecrawl)).resolves.toBeUndefined();
  });
});
