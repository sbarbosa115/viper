/**
 * Every Tool's key (FR-23, FR-24). Research flow steps name their allowed Tools with these.
 * Claude is metered as two Tools per model role: `claude.<role>` counts 1k input tokens and
 * `claude.<role>.out` counts 1k output tokens; one model call records a Tool call on each.
 */
export const TOOL_KEYS = {
  googlePlaces: 'google.places-text-search',
  googleGeocoding: 'google.geocoding',
  apifyGoogleMaps: 'apify.google-maps',
  apifyInstagram: 'apify.instagram-profile',
  apifyYelp: 'apify.yelp',
  overpass: 'osm.overpass',
  firecrawl: 'firecrawl.scrape',
  apolloOrganization: 'apollo.organization-enrich',
  apolloPeople: 'apollo.people-match',
  hunter: 'hunter.domain-search',
  zerobounce: 'zerobounce.validate',
  twilioLookup: 'twilio.lookup-line-type',
  claudePlanning: 'claude.planning',
  claudePlanningOut: 'claude.planning.out',
  claudeChat: 'claude.chat',
  claudeChatOut: 'claude.chat.out',
  claudeFast: 'claude.fast',
  claudeFastOut: 'claude.fast.out',
} as const;

export type ToolKey = (typeof TOOL_KEYS)[keyof typeof TOOL_KEYS];

export const ALL_TOOL_KEYS: readonly ToolKey[] = Object.values(TOOL_KEYS);

export type ClaudeRole = 'planning' | 'chat' | 'fast';

/** The input-token Tool and the output-token Tool of a model role. */
export const CLAUDE_TOOLS: Readonly<Record<ClaudeRole, { in: ToolKey; out: ToolKey }>> = {
  planning: { in: TOOL_KEYS.claudePlanning, out: TOOL_KEYS.claudePlanningOut },
  chat: { in: TOOL_KEYS.claudeChat, out: TOOL_KEYS.claudeChatOut },
  fast: { in: TOOL_KEYS.claudeFast, out: TOOL_KEYS.claudeFastOut },
};

/** Which credentials a Tool needs in Platform settings (`null`: none, e.g. Overpass). */
export type ProviderRequirement =
  | 'anthropic'
  | 'apify'
  | 'googleMaps'
  | 'firecrawl'
  | 'apollo'
  | 'hunter'
  | 'zerobounce'
  | 'twilio'
  | null;
