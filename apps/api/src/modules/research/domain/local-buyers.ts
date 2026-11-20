import type { FlowSettingsSnapshot } from './flow.js';

/** The Tool keys the "Local buyers" flow uses (the tools module's catalog keys, FR-23/FR-24). */
export const TOOL_KEYS = {
  googlePlaces: 'google.places-text-search',
  mapsScraper: 'apify.google-maps',
  overpass: 'osm.overpass',
  firecrawl: 'firecrawl.scrape',
  instagram: 'apify.instagram-profile',
  yelp: 'apify.yelp',
  apolloPeople: 'apollo.people-match',
  hunter: 'hunter.domain-search',
  zerobounce: 'zerobounce.validate',
  twilio: 'twilio.lookup-line-type',
  claudeFast: 'claude.fast',
  claudePlanning: 'claude.planning',
} as const;

export const LOCAL_BUYERS_KEY = 'local-buyers';

/** Steps run by code, without Claude (FR-19 Merge and Deliver). */
export const DETERMINISTIC_STEPS: readonly string[] = ['merge', 'deliver'];

/** Steps 2–7 collect; when collection stops (FR-20) the run moves on to Verify, Score, Deliver. */
export const COLLECTION_STEPS: readonly string[] = [
  'maps-places',
  'pre-score',
  'websites',
  'socials-reviews',
  'contacts',
];

/**
 * Flow template "Local buyers" v1 with the seeded settings (FR-19, FR-37, PRD section 13). Each
 * agent Step lists the Claude Tool it runs on: the fast model routes Tool calls in Steps 2 and
 * 6–8 (one planning-model turn per item would spend most of a 400-credit budget); Score & pitch
 * uses the planning model. Staff can change a Step's model in the flow settings. The Steps' time
 * limits add up to the max active time (60 min); the lease (worker-stopped timeout) outlasts the
 * longest Tool call with its retries.
 */
export const LOCAL_BUYERS_V1: FlowSettingsSnapshot = {
  key: LOCAL_BUYERS_KEY,
  name: 'Local buyers',
  version: 1,
  runSettings: {
    maxActiveMinutes: 60,
    maxTotalHours: 3,
    maxAttempts: 3,
    retryWaitsMinutes: [1, 5, 15],
    workerStoppedAfterMinutes: 5,
    scoreAtBudgetPct: 80,
    scoreAtMinutes: 45,
  },
  planDefaults: { maxCredits: 400, maxLeads: 100, minFitScore: 60 },
  steps: [
    {
      key: 'search-terms',
      name: 'Search terms',
      tools: [TOOL_KEYS.claudeFast],
      budgetPct: 2,
      timeLimitMinutes: 2,
      required: true,
    },
    {
      key: 'maps-places',
      name: 'Maps & places',
      tools: [
        TOOL_KEYS.googlePlaces,
        TOOL_KEYS.mapsScraper,
        TOOL_KEYS.overpass,
        TOOL_KEYS.claudeFast,
      ],
      budgetPct: 30,
      timeLimitMinutes: 12,
      required: true,
    },
    { key: 'merge', name: 'Merge', tools: [], budgetPct: 0, timeLimitMinutes: 1, required: true },
    {
      key: 'pre-score',
      name: 'Pre-score',
      tools: [TOOL_KEYS.claudeFast],
      budgetPct: 5,
      timeLimitMinutes: 4,
      required: true,
    },
    {
      key: 'websites',
      name: 'Websites',
      tools: [TOOL_KEYS.firecrawl, TOOL_KEYS.claudeFast],
      budgetPct: 20,
      timeLimitMinutes: 12,
      required: true,
    },
    {
      key: 'socials-reviews',
      name: 'Socials & reviews',
      tools: [TOOL_KEYS.instagram, TOOL_KEYS.yelp, TOOL_KEYS.claudeFast],
      budgetPct: 13,
      timeLimitMinutes: 6,
      required: false,
    },
    {
      key: 'contacts',
      name: 'Contacts',
      tools: [TOOL_KEYS.apolloPeople, TOOL_KEYS.hunter, TOOL_KEYS.claudeFast],
      budgetPct: 10,
      timeLimitMinutes: 5,
      required: false,
    },
    {
      key: 'verify',
      name: 'Verify',
      tools: [TOOL_KEYS.zerobounce, TOOL_KEYS.twilio, TOOL_KEYS.claudeFast],
      budgetPct: 8,
      timeLimitMinutes: 6,
      required: true,
    },
    {
      key: 'score-pitch',
      name: 'Score & pitch',
      tools: [TOOL_KEYS.claudePlanning],
      budgetPct: 12,
      timeLimitMinutes: 10,
      required: true,
    },
    {
      key: 'deliver',
      name: 'Deliver',
      tools: [],
      budgetPct: 0,
      timeLimitMinutes: 2,
      required: true,
    },
  ],
};
