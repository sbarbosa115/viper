import { TOOL_KEYS, type ProviderRequirement, type ToolKey } from './tool-keys.js';

export interface ToolDefinition {
  readonly key: ToolKey;
  readonly name: string;
  readonly provider: string;
  readonly unit: string;
  /** Estimated from the provider's list price (2026-11); the first runs measure the real cost. */
  readonly providerCostMicrosPerUnit: number;
  readonly creditsPerUnit: number;
  readonly maxUnitsPerCall: number;
  readonly requires: ProviderRequirement;
}

/**
 * The Tool catalog with the seeded Rate card (FR-23, PRD 8a). Credits are set for a margin of at
 * least 60% at 1 credit = $0.01. Provider costs are estimates from public list prices:
 * Places Text Search (New) Enterprise $35/1k, Geocoding $5/1k, Apify actors per result
 * (Google Maps ~$4/1k, Instagram profiles ~$2.60/1k, Yelp ~$10/1k), Firecrawl ~$1/1k pages,
 * Apollo ~$0.025 a credit, Hunter ~$0.0245 a search, ZeroBounce $0.008 an email, Twilio Lookup
 * line type $0.008, Claude per 1k tokens (Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5
 * $0.10/$0.50 per million in/out). Overpass is free; 0.1 credit covers its share of hosting.
 */
export const TOOL_CATALOG: readonly ToolDefinition[] = [
  {
    key: TOOL_KEYS.googlePlaces,
    name: 'Google Places Text Search',
    provider: 'Google Maps Platform',
    unit: 'request',
    providerCostMicrosPerUnit: 35_000,
    creditsPerUnit: 9,
    maxUnitsPerCall: 1,
    requires: 'googleMaps',
  },
  {
    key: TOOL_KEYS.googleGeocoding,
    name: 'Google Geocoding',
    provider: 'Google Maps Platform',
    unit: 'request',
    providerCostMicrosPerUnit: 5_000,
    creditsPerUnit: 1.5,
    maxUnitsPerCall: 1,
    requires: 'googleMaps',
  },
  {
    key: TOOL_KEYS.apifyGoogleMaps,
    name: 'Apify Google Maps scraper',
    provider: 'Apify',
    unit: 'result',
    providerCostMicrosPerUnit: 4_000,
    creditsPerUnit: 1.2,
    maxUnitsPerCall: 100,
    requires: 'apify',
  },
  {
    key: TOOL_KEYS.apifyInstagram,
    name: 'Apify Instagram profile scraper',
    provider: 'Apify',
    unit: 'result',
    providerCostMicrosPerUnit: 2_600,
    creditsPerUnit: 0.8,
    maxUnitsPerCall: 20,
    requires: 'apify',
  },
  {
    key: TOOL_KEYS.apifyYelp,
    name: 'Apify Yelp scraper',
    provider: 'Apify',
    unit: 'result',
    providerCostMicrosPerUnit: 10_000,
    creditsPerUnit: 3,
    maxUnitsPerCall: 20,
    requires: 'apify',
  },
  {
    key: TOOL_KEYS.overpass,
    name: 'Overpass (OpenStreetMap)',
    provider: 'OpenStreetMap',
    unit: 'request',
    providerCostMicrosPerUnit: 0,
    creditsPerUnit: 0.1,
    maxUnitsPerCall: 1,
    requires: null,
  },
  {
    key: TOOL_KEYS.firecrawl,
    name: 'Firecrawl scrape',
    provider: 'Firecrawl',
    unit: 'page',
    providerCostMicrosPerUnit: 1_000,
    creditsPerUnit: 0.3,
    maxUnitsPerCall: 1,
    requires: 'firecrawl',
  },
  {
    key: TOOL_KEYS.apolloOrganization,
    name: 'Apollo organization enrichment',
    provider: 'Apollo',
    unit: 'request',
    providerCostMicrosPerUnit: 25_000,
    creditsPerUnit: 7,
    maxUnitsPerCall: 1,
    requires: 'apollo',
  },
  {
    key: TOOL_KEYS.apolloPeople,
    name: 'Apollo people enrichment',
    provider: 'Apollo',
    unit: 'request',
    providerCostMicrosPerUnit: 25_000,
    creditsPerUnit: 7,
    maxUnitsPerCall: 1,
    requires: 'apollo',
  },
  {
    key: TOOL_KEYS.hunter,
    name: 'Hunter domain search',
    provider: 'Hunter',
    unit: 'request',
    providerCostMicrosPerUnit: 24_500,
    creditsPerUnit: 7,
    maxUnitsPerCall: 1,
    requires: 'hunter',
  },
  {
    key: TOOL_KEYS.zerobounce,
    name: 'ZeroBounce email validation',
    provider: 'ZeroBounce',
    unit: 'email',
    providerCostMicrosPerUnit: 8_000,
    creditsPerUnit: 2.5,
    maxUnitsPerCall: 1,
    requires: 'zerobounce',
  },
  {
    key: TOOL_KEYS.twilioLookup,
    name: 'Twilio Lookup line type',
    provider: 'Twilio',
    unit: 'lookup',
    providerCostMicrosPerUnit: 8_000,
    creditsPerUnit: 2.5,
    maxUnitsPerCall: 1,
    requires: 'twilio',
  },
  ...claudeTools('planning', 'Claude planning model', 4_000, 1.2, 20_000, 6),
  ...claudeTools('chat', 'Claude chat model', 2_000, 0.6, 10_000, 3),
  ...claudeTools('fast', 'Claude fast model', 100, 0.03, 500, 0.15),
];

function claudeTools(
  role: 'planning' | 'chat' | 'fast',
  name: string,
  inMicros: number,
  inCredits: number,
  outMicros: number,
  outCredits: number,
): ToolDefinition[] {
  const keys = {
    planning: [TOOL_KEYS.claudePlanning, TOOL_KEYS.claudePlanningOut],
    chat: [TOOL_KEYS.claudeChat, TOOL_KEYS.claudeChatOut],
    fast: [TOOL_KEYS.claudeFast, TOOL_KEYS.claudeFastOut],
  }[role];
  const [inKey, outKey] = keys as [ToolKey, ToolKey];
  return [
    {
      key: inKey,
      name: `${name} (input)`,
      provider: 'Anthropic',
      unit: '1k tokens in',
      providerCostMicrosPerUnit: inMicros,
      creditsPerUnit: inCredits,
      maxUnitsPerCall: 200,
      requires: 'anthropic',
    },
    {
      key: outKey,
      name: `${name} (output)`,
      provider: 'Anthropic',
      unit: '1k tokens out',
      providerCostMicrosPerUnit: outMicros,
      creditsPerUnit: outCredits,
      maxUnitsPerCall: 64,
      requires: 'anthropic',
    },
  ];
}

const BY_KEY = new Map<string, ToolDefinition>(TOOL_CATALOG.map((d) => [d.key, d]));

export function toolDefinition(key: string): ToolDefinition | undefined {
  return BY_KEY.get(key);
}
