import { TOOL_KEYS } from '../../domain/local-buyers.js';
import type { ProspectContact, ProspectInput, SourceRef, Verification } from '../ports.js';
import {
  asNumber,
  asRecord,
  asString,
  asStrings,
  fallbackSource,
  type StepContext,
  type WorkItem,
} from './step-context.js';

/**
 * How the agent uses each provider Tool: what it fills in, the input sent to the ToolRunner, and
 * what a successful output changes. Inputs and outputs follow the tools module's schemas
 * (`modules/tools/infrastructure/tool-io.ts`, FR-24); output parsing is lenient so a missing
 * optional field never breaks a run.
 */
export interface ToolEffect {
  /** True when this call completes the work item. */
  readonly itemDone: boolean;
  /** What the agent sees of the output (kept small). */
  readonly view: unknown;
  /** Merged into the Step's progress data (e.g. `prospectsFound`). */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface ToolKind {
  readonly description: string;
  /** JSON Schema properties the agent fills in besides `item` and `notes`. */
  readonly params: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  /** The ToolRunner input, or an error message for the agent. */
  runnerInput(
    llmInput: Record<string, unknown>,
    item: WorkItem,
    ctx: StepContext,
  ): Record<string, unknown> | string;
  effect(args: {
    ctx: StepContext;
    toolKey: string;
    item: WorkItem;
    output: unknown;
    within: object;
  }): Promise<ToolEffect>;
}

const MARKDOWN_VIEW_CHARS = 6_000;
const METERS_PER_MILE = 1_609.344;
const MAX_RADIUS_METERS = 40_000;

function sourceFrom(raw: unknown, name: string, url: string | null, at: Date): SourceRef {
  const s = asRecord(raw);
  const sName = asString(s.name);
  if (!sName) return fallbackSource(name, url, at);
  return {
    name: sName,
    url: asString(s.url),
    retrievedAt: asString(s.retrievedAt) ?? at.toISOString(),
  };
}

const SOURCE_NAMES: Readonly<Record<string, string>> = {
  [TOOL_KEYS.googlePlaces]: 'Google Maps',
  [TOOL_KEYS.mapsScraper]: 'Google Maps',
  [TOOL_KEYS.overpass]: 'OpenStreetMap',
  [TOOL_KEYS.firecrawl]: 'Website',
  [TOOL_KEYS.instagram]: 'Instagram',
  [TOOL_KEYS.yelp]: 'Yelp',
  [TOOL_KEYS.apolloPeople]: 'Apollo',
  [TOOL_KEYS.hunter]: 'Hunter',
  [TOOL_KEYS.zerobounce]: 'ZeroBounce',
  [TOOL_KEYS.twilio]: 'Twilio Lookup',
};

export function sourceName(toolKey: string): string {
  return SOURCE_NAMES[toolKey] ?? toolKey;
}

function radiusMeters(ctx: StepContext): number {
  return Math.min(MAX_RADIUS_METERS, Math.round(ctx.plan.searchArea.radiusMiles * METERS_PER_MILE));
}

function center(ctx: StepContext) {
  return { lat: ctx.plan.searchArea.lat, lng: ctx.plan.searchArea.lng };
}

function first(list: unknown): Record<string, unknown> {
  return asRecord(Array.isArray(list) ? list[0] : undefined);
}

// Places (Step 2) ---------------------------------------------------------------------------------

function placeFrom(
  raw: unknown,
  toolKey: string,
  segmentId: string | null,
  at: Date,
): ProspectInput | null {
  const p = asRecord(raw);
  const name = asString(p.name);
  const placeKey = asString(p.placeKey);
  if (!name || !placeKey) return null;
  return {
    placeKeys: [placeKey],
    name,
    address: asString(p.address),
    lat: asNumber(p.lat),
    lng: asNumber(p.lng),
    category: asString(p.category),
    phone: asString(p.phone),
    website: asString(p.website),
    rating: asNumber(p.rating),
    reviewsCount: asNumber(p.reviewCount),
    segmentId,
    source: sourceFrom(p.source, sourceName(toolKey), asString(p.mapsUrl), at),
  };
}

async function addPlaces(args: {
  ctx: StepContext;
  toolKey: string;
  item: WorkItem;
  output: unknown;
  within: object;
}): Promise<ToolEffect> {
  const { ctx, toolKey, item, output, within } = args;
  const out = asRecord(output);
  const segmentId = asString(item.data.segmentId);
  const places = (Array.isArray(out.places) ? out.places : [])
    .map((p) => placeFrom(p, toolKey, segmentId, ctx.now()))
    .filter((p): p is ProspectInput => p !== null);
  if (places.length === 0) return { itemDone: true, view: { found: 0 } };
  const { added, total } = await ctx.prospects.addProspects(
    ctx.runId,
    ctx.businessId,
    places,
    within,
  );
  return {
    itemDone: true,
    view: { found: places.length, newProspects: added, prospectsSoFar: total },
    data: { prospectsFound: total },
  };
}

const queryParam = {
  query: { type: 'string', description: 'The search term, e.g. "bakery"; defaults to the item' },
};

const googlePlacesKind: ToolKind = {
  description: 'Google Places text search for a term inside the Plan’s search area.',
  params: queryParam,
  required: [],
  runnerInput: (llmInput, item, ctx) => ({
    textQuery: asString(llmInput.query) ?? item.label,
    center: center(ctx),
    radiusMeters: radiusMeters(ctx),
  }),
  effect: addPlaces,
};

const mapsScraperKind: ToolKind = {
  description: 'Google Maps scraper (Apify) for a term inside the Plan’s search area.',
  params: queryParam,
  required: [],
  runnerInput: (llmInput, item, ctx) => ({
    searchTerm: asString(llmInput.query) ?? item.label,
    center: center(ctx),
    radiusKm: Math.max(0.1, Math.round(radiusMeters(ctx) / 100) / 10),
    maxItems: 50,
  }),
  effect: addPlaces,
};

/** OpenStreetMap tags for common search terms (the agent may give its own). */
const OSM_TAGS: readonly [RegExp, { key: string; value: string }][] = [
  [/bak|bread|pastr|kolache/, { key: 'shop', value: 'bakery' }],
  [/caf|coffee|espresso/, { key: 'amenity', value: 'cafe' }],
  [
    /dessert|cake|confection|candy|chocolate|donut|doughnut/,
    { key: 'shop', value: 'confectionery' },
  ],
  [/ice cream|gelato/, { key: 'amenity', value: 'ice_cream' }],
  [/restaurant|brunch|diner|bistro/, { key: 'amenity', value: 'restaurant' }],
  [/\bbar\b|\bpub\b/, { key: 'amenity', value: 'bar' }],
];

function osmTags(
  llmInput: Record<string, unknown>,
  term: string,
): { key: string; value: string }[] {
  const given = (Array.isArray(llmInput.tags) ? llmInput.tags : [])
    .map(asRecord)
    .map((t) => ({ key: asString(t.key), value: asString(t.value) }))
    .filter((t): t is { key: string; value: string } => t.key !== null && t.value !== null)
    .slice(0, 10);
  if (given.length) return given;
  const lower = term.toLowerCase();
  const match = OSM_TAGS.filter(([re]) => re.test(lower)).map(([, tag]) => tag);
  return match.length ? match : [{ key: 'shop', value: 'bakery' }];
}

const overpassKind: ToolKind = {
  description:
    'OpenStreetMap places by tag inside the search area (e.g. shop=bakery, amenity=cafe).',
  params: {
    tags: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, value: { type: 'string' } },
        required: ['key', 'value'],
      },
    },
  },
  required: [],
  runnerInput: (llmInput, item, ctx) => ({
    center: center(ctx),
    radiusMeters: radiusMeters(ctx),
    tags: osmTags(llmInput, item.label),
    limit: 100,
  }),
  effect: addPlaces,
};

// Websites (Step 5) -------------------------------------------------------------------------------

const websiteKind: ToolKind = {
  description:
    'Read the work item’s website (as markdown). Then call record_website_facts with what it says.',
  params: {},
  required: [],
  runnerInput(_llmInput, item) {
    const url = asString(item.data.website);
    return url ? { url } : 'This Prospect has no website';
  },
  effect({ output }) {
    const out = asRecord(output);
    const markdown = asString(out.markdown) ?? '';
    return Promise.resolve({
      itemDone: false,
      view: {
        url: asString(out.url),
        title: asString(out.title),
        markdown: markdown.slice(0, MARKDOWN_VIEW_CHARS),
      },
    });
  },
};

// Socials and reviews (Step 6) --------------------------------------------------------------------

/** `https://instagram.com/sunrise.bakery/` → `sunrise.bakery`. */
export function instagramUsername(url: string): string | null {
  const m =
    /instagram\.com\/([A-Za-z0-9._]{1,30})/.exec(url) ?? /^@?([A-Za-z0-9._]{1,30})$/.exec(url);
  return m?.[1]?.toLowerCase() ?? null;
}

async function addEvidence(
  ctx: StepContext,
  item: WorkItem,
  facts: readonly string[],
  source: SourceRef,
  within: object,
): Promise<void> {
  if (facts.length === 0) return;
  await ctx.prospects.updateProspect(
    String(item.data.prospectId),
    { addEvidence: facts.map((fact) => ({ fact, points: 0, source })), addSources: [source] },
    within,
  );
}

const instagramKind: ToolKind = {
  description: 'Read the work item’s Instagram profile: bio, followers, posts.',
  params: {},
  required: [],
  runnerInput(_llmInput, item) {
    const username = instagramUsername(asString(item.data.url) ?? '');
    return username ? { usernames: [username] } : 'No Instagram username in this link';
  },
  async effect({ ctx, toolKey, item, output, within }) {
    const profile = first(asRecord(output).profiles);
    const url = asString(item.data.url);
    const source = sourceFrom(profile.source, sourceName(toolKey), url, ctx.now());
    const facts: string[] = [];
    const bio = asString(profile.bio);
    const followers = asNumber(profile.followers);
    if (bio) facts.push(`Instagram bio: "${bio.slice(0, 200)}"`);
    if (followers !== null) facts.push(`${followers} Instagram followers`);
    await addEvidence(ctx, item, facts, source, within);
    return { itemDone: true, view: { facts } };
  },
};

const yelpKind: ToolKind = {
  description: 'Read the work item’s Yelp page: rating, review count, review snippets.',
  params: {},
  required: [],
  runnerInput(_llmInput, item) {
    const url = asString(item.data.url);
    return url ? { urls: [url], maxItems: 1 } : 'This work item has no Yelp link';
  },
  async effect({ ctx, toolKey, item, output, within }) {
    const biz = first(asRecord(output).businesses);
    const url = asString(item.data.url);
    const source = sourceFrom(biz.source, sourceName(toolKey), url, ctx.now());
    const facts: string[] = [];
    const rating = asNumber(biz.rating);
    const count = asNumber(biz.reviewCount);
    if (rating !== null) {
      facts.push(`Rated ${rating} on Yelp${count !== null ? ` (${count} reviews)` : ''}`);
    }
    for (const snippet of asStrings(biz.reviewSnippets).slice(0, 2)) {
      facts.push(`Yelp review: "${snippet.slice(0, 200)}"`);
    }
    await addEvidence(ctx, item, facts, source, within);
    return { itemDone: true, view: { facts } };
  },
};

// Contacts (Step 7) -------------------------------------------------------------------------------

async function addEmails(
  ctx: StepContext,
  item: WorkItem,
  emails: readonly { value: string; label: string | null }[],
  source: SourceRef,
  within: object,
): Promise<ToolEffect> {
  const valid = emails.filter((e) => e.value.includes('@')).slice(0, 5);
  if (valid.length) {
    const contacts: ProspectContact[] = valid.map((e) => ({
      type: 'email',
      value: e.value.toLowerCase(),
      label: e.label,
      verification: 'unverified',
      source,
    }));
    await ctx.prospects.updateProspect(
      String(item.data.prospectId),
      { addContacts: contacts },
      within,
    );
  }
  return { itemDone: true, view: { emails: valid.map((e) => e.value) } };
}

const apolloPeopleKind: ToolKind = {
  description: 'Find the business email of the owner (or a given title) at the item’s domain.',
  params: { title: { type: 'string', description: 'Defaults to "Owner"' } },
  required: [],
  runnerInput(llmInput, item) {
    const domain = asString(item.data.domain);
    return domain ? { domain, title: asString(llmInput.title) ?? 'Owner' } : 'No domain';
  },
  effect({ ctx, toolKey, item, output, within }) {
    const out = asRecord(output);
    const person = asRecord(out.person);
    const email = asString(person.email);
    const source = sourceFrom(out.source, sourceName(toolKey), null, ctx.now());
    const label = asString(person.title);
    return addEmails(ctx, item, email ? [{ value: email, label }] : [], source, within);
  },
};

const hunterKind: ToolKind = {
  description: 'Find the business email addresses published for the item’s domain.',
  params: {},
  required: [],
  runnerInput(_llmInput, item) {
    const domain = asString(item.data.domain);
    return domain ? { domain, limit: 5 } : 'No domain';
  },
  effect({ ctx, toolKey, item, output, within }) {
    const out = asRecord(output);
    const source = sourceFrom(out.source, sourceName(toolKey), null, ctx.now());
    const emails = (Array.isArray(out.emails) ? out.emails : [])
      .map(asRecord)
      .filter((e) => e.type !== 'personal')
      .map((e) => ({ value: asString(e.email), label: asString(e.position) }))
      .filter((e): e is { value: string; label: string | null } => e.value !== null);
    return addEmails(ctx, item, emails, source, within);
  },
};

// Verify (Step 8) ---------------------------------------------------------------------------------

const INVALID_EMAIL = ['invalid', 'spamtrap', 'abuse', 'do_not_mail'];

function verificationOf(out: Record<string, unknown>, type: 'email' | 'phone'): Verification {
  const verdict = asString(out.verdict);
  if (verdict === 'verified') return 'verified';
  if (verdict === 'invalid') return 'invalid';
  if (verdict === 'unknown') return 'unverified';
  if (type === 'phone') {
    if (out.valid === true) return 'verified';
    return out.valid === false ? 'invalid' : 'unverified';
  }
  const status = asString(out.status)?.toLowerCase() ?? '';
  if (status === 'valid') return 'verified';
  return INVALID_EMAIL.includes(status) ? 'invalid' : 'unverified';
}

function verifyKind(type: 'email' | 'phone'): ToolKind {
  return {
    description:
      type === 'email'
        ? 'Check that the work item’s email address accepts mail.'
        : 'Check that the work item’s phone number is a valid number.',
    params: {},
    required: [],
    runnerInput(_llmInput, item) {
      const value = asString(item.data.value);
      if (!value) return 'Nothing to verify';
      return type === 'email' ? { email: value } : { phone: value };
    },
    async effect({ ctx, toolKey, item, output, within }) {
      const out = asRecord(output);
      const verification = verificationOf(out, type);
      const value = String(item.data.value);
      const source = sourceFrom(out.source, sourceName(toolKey), null, ctx.now());
      await ctx.prospects.updateProspect(
        String(item.data.prospectId),
        { verifyContacts: [{ type, value, verification, source }] },
        within,
      );
      return { itemDone: true, view: { value, verification } };
    },
  };
}

/** Every provider Tool the "Local buyers" flow can use, by Tool key. */
export const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  [TOOL_KEYS.googlePlaces]: googlePlacesKind,
  [TOOL_KEYS.mapsScraper]: mapsScraperKind,
  [TOOL_KEYS.overpass]: overpassKind,
  [TOOL_KEYS.firecrawl]: websiteKind,
  [TOOL_KEYS.instagram]: instagramKind,
  [TOOL_KEYS.yelp]: yelpKind,
  [TOOL_KEYS.apolloPeople]: apolloPeopleKind,
  [TOOL_KEYS.hunter]: hunterKind,
  [TOOL_KEYS.zerobounce]: verifyKind('email'),
  [TOOL_KEYS.twilio]: verifyKind('phone'),
};
