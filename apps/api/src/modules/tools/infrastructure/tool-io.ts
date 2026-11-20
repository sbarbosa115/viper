import { z } from 'zod';

/**
 * Each Tool's input and normalised output (FR-24). Research builds inputs with these types and
 * reads outputs with them; every fact carries a Source (name, URL, retrieved at; NFR-5).
 */

export const source = z.object({
  name: z.string().min(1),
  url: z.string().nullable(),
  retrievedAt: z.iso.datetime(),
});
export type Source = z.infer<typeof source>;

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'A domain such as example.com');

/** A place from a map source. `placeKey` is unique per source: `google:<id>`, `osm:node/<id>`. */
export const place = z.object({
  placeKey: z.string().min(1),
  name: z.string().min(1),
  address: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  category: z.string().nullable(),
  categories: z.array(z.string()),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  rating: z.number().nullable(),
  reviewCount: z.int().nullable(),
  mapsUrl: z.string().nullable(),
  source,
});
export type Place = z.infer<typeof place>;

// Google Places Text Search (New) — 1 request per page of up to 20 places.
export const placesSearchInput = z.object({
  textQuery: z.string().trim().min(1).max(200),
  center: point,
  radiusMeters: z.number().min(1).max(50_000),
  pageToken: z.string().min(1).max(2_000).optional(),
});
export type PlacesSearchInput = z.infer<typeof placesSearchInput>;
export const placesSearchOutput = z.object({
  places: z.array(place),
  nextPageToken: z.string().nullable(),
});
export type PlacesSearchOutput = z.infer<typeof placesSearchOutput>;

// Google Geocoding — 1 request.
export const geocodeInput = z.object({
  query: z.string().trim().min(1).max(300),
  limit: z.int().min(1).max(10).default(5),
});
export type GeocodeInput = z.infer<typeof geocodeInput>;
export const geocodeOutput = z.object({
  results: z.array(
    z.object({
      label: z.string(),
      lat: z.number(),
      lng: z.number(),
      placeId: z.string().nullable(),
    }),
  ),
  source,
});
export type GeocodeOutput = z.infer<typeof geocodeOutput>;

// Apify Google Maps scraper — 1 unit per place returned.
export const mapsScrapeInput = z.object({
  searchTerm: z.string().trim().min(1).max(200),
  center: point,
  radiusKm: z.number().min(0.1).max(50),
  maxItems: z.int().min(1).max(100).default(20),
});
export type MapsScrapeInput = z.infer<typeof mapsScrapeInput>;
export const mapsScrapeOutput = z.object({ places: z.array(place) });
export type MapsScrapeOutput = z.infer<typeof mapsScrapeOutput>;

// Apify Instagram profile scraper — 1 unit per profile returned.
export const instagramInput = z.object({
  usernames: z
    .array(
      z
        .string()
        .trim()
        .regex(/^@?[A-Za-z0-9._]{1,30}$/),
    )
    .min(1)
    .max(20)
    .transform((names) => names.map((n) => n.replace(/^@/, '').toLowerCase())),
});
export type InstagramInput = z.input<typeof instagramInput>;
export const instagramProfile = z.object({
  username: z.string(),
  fullName: z.string().nullable(),
  bio: z.string().nullable(),
  followers: z.int().nullable(),
  posts: z.int().nullable(),
  externalUrl: z.string().nullable(),
  category: z.string().nullable(),
  isBusiness: z.boolean(),
  url: z.string(),
  source,
});
export const instagramOutput = z.object({ profiles: z.array(instagramProfile) });
export type InstagramOutput = z.infer<typeof instagramOutput>;

// Apify Yelp scraper — 1 unit per business returned.
export const yelpInput = z
  .object({
    searchTerm: z.string().trim().min(1).max(200).optional(),
    location: z.string().trim().min(1).max(200).optional(),
    urls: z.array(z.url()).min(1).max(20).optional(),
    maxItems: z.int().min(1).max(20).default(10),
  })
  .refine((i) => i.urls !== undefined || (i.searchTerm !== undefined && i.location !== undefined), {
    message: 'Give Yelp URLs, or a search term and a location',
  });
export type YelpInput = z.input<typeof yelpInput>;
export const yelpBusiness = z.object({
  yelpId: z.string(),
  name: z.string(),
  url: z.string(),
  rating: z.number().nullable(),
  reviewCount: z.int().nullable(),
  categories: z.array(z.string()),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  address: z.string().nullable(),
  reviewSnippets: z.array(z.string()),
  source,
});
export const yelpOutput = z.object({ businesses: z.array(yelpBusiness) });
export type YelpOutput = z.infer<typeof yelpOutput>;

// Overpass (OpenStreetMap) — 1 request.
export const overpassInput = z.object({
  center: point,
  radiusMeters: z.number().min(1).max(40_000),
  tags: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z_:]{1,40}$/),
        value: z.string().regex(/^[A-Za-z0-9_ ;-]{1,60}$/),
      }),
    )
    .min(1)
    .max(10),
  limit: z.int().min(1).max(200).default(100),
});
export type OverpassInput = z.input<typeof overpassInput>;
export const overpassOutput = z.object({ places: z.array(place) });
export type OverpassOutput = z.infer<typeof overpassOutput>;

// Firecrawl scrape — 1 page.
export const scrapeInput = z.object({ url: z.url().max(2_048) });
export type ScrapeInput = z.infer<typeof scrapeInput>;
export const scrapeOutput = z.object({
  url: z.string(),
  title: z.string().nullable(),
  /** Main content as Markdown, at most 50,000 characters. */
  markdown: z.string(),
  statusCode: z.int().nullable(),
  source,
});
export type ScrapeOutput = z.infer<typeof scrapeOutput>;
export const MAX_MARKDOWN_CHARS = 50_000;

// Apollo organization enrichment — 1 request.
export const organizationInput = z.object({ domain });
export type OrganizationInput = z.input<typeof organizationInput>;
export const organizationOutput = z.object({
  organization: z
    .object({
      name: z.string(),
      domain: z.string().nullable(),
      website: z.string().nullable(),
      phone: z.string().nullable(),
      industry: z.string().nullable(),
      employees: z.int().nullable(),
      description: z.string().nullable(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      linkedinUrl: z.string().nullable(),
      facebookUrl: z.string().nullable(),
    })
    .nullable(),
  source,
});
export type OrganizationOutput = z.infer<typeof organizationOutput>;

// Apollo people enrichment — 1 request (business contacts only: no personal emails, ADR 0007).
export const personInput = z
  .object({
    domain,
    name: z.string().trim().min(1).max(120).optional(),
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .refine((p) => p.name !== undefined || p.firstName !== undefined || p.title !== undefined, {
    message: 'Give a name or a title',
  });
export type PersonInput = z.input<typeof personInput>;
export const personOutput = z.object({
  person: z
    .object({
      name: z.string(),
      title: z.string().nullable(),
      email: z.string().nullable(),
      /** Apollo's own status, e.g. "verified", "guessed", "unavailable". */
      emailStatus: z.string().nullable(),
      linkedinUrl: z.string().nullable(),
      organizationName: z.string().nullable(),
    })
    .nullable(),
  source,
});
export type PersonOutput = z.infer<typeof personOutput>;

// Hunter domain search — 1 request.
export const domainSearchInput = z.object({ domain, limit: z.int().min(1).max(10).default(10) });
export type DomainSearchInput = z.input<typeof domainSearchInput>;
export const domainSearchOutput = z.object({
  domain: z.string(),
  organization: z.string().nullable(),
  emails: z.array(
    z.object({
      email: z.string(),
      type: z.enum(['personal', 'generic']).nullable(),
      confidence: z.int().nullable(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      position: z.string().nullable(),
      sourceUrl: z.string().nullable(),
    }),
  ),
  source,
});
export type DomainSearchOutput = z.infer<typeof domainSearchOutput>;

/** A contact check's result as a Lead shows it (FR-25). */
export const verdict = z.enum(['verified', 'invalid', 'unknown']);
export type Verdict = z.infer<typeof verdict>;

// ZeroBounce validate — 1 email.
export const emailCheckInput = z.object({ email: z.email().max(254) });
export type EmailCheckInput = z.infer<typeof emailCheckInput>;
export const emailCheckOutput = z.object({
  email: z.string(),
  /** ZeroBounce status: valid, invalid, catch-all, unknown, spamtrap, abuse, do_not_mail. */
  status: z.string(),
  subStatus: z.string().nullable(),
  verdict,
  source,
});
export type EmailCheckOutput = z.infer<typeof emailCheckOutput>;

// Twilio Lookup v2 line type intelligence — 1 lookup.
export const phoneCheckInput = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^[+\d().\s-]{7,25}$/, 'A phone number'),
});
export type PhoneCheckInput = z.infer<typeof phoneCheckInput>;
export const phoneCheckOutput = z.object({
  phoneNumber: z.string().nullable(),
  valid: z.boolean(),
  /** landline, mobile, fixedVoip, nonFixedVoip, tollFree, … */
  lineType: z.string().nullable(),
  carrier: z.string().nullable(),
  verdict,
  source,
});
export type PhoneCheckOutput = z.infer<typeof phoneCheckOutput>;

// Claude (Anthropic Messages) — 1k tokens in on `claude.<role>`, 1k tokens out on `.out`.
export const claudeInput = z.object({
  system: z.string().max(200_000),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) }))
    .min(1),
  tools: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        description: z.string(),
        inputSchema: z.record(z.string(), z.unknown()),
      }),
    )
    .max(20)
    .optional(),
  maxTokens: z.int().min(1).max(64_000).default(1_024),
  /** For logs, e.g. "research.search-terms". */
  purpose: z.string().min(1).max(64),
  timeoutMs: z.int().min(1_000).max(600_000).optional(),
});
export type ClaudeInput = z.input<typeof claudeInput>;
export const claudeOutput = z.object({
  text: z.string(),
  toolCall: z.object({ name: z.string(), input: z.unknown() }).nullable(),
  usage: z.object({ inputTokens: z.int().nonnegative(), outputTokens: z.int().nonnegative() }),
  model: z.string(),
  source,
});
export type ClaudeOutput = z.infer<typeof claudeOutput>;
