/**
 * Fixture data for research tests: 30 invented Austin bakeries (no real businesses or people),
 * and what each fake Tool answers about them, in the normalised shapes the agent expects.
 */
const NAMES = [
  'Sunrise Bakery',
  'Golden Crust',
  'Sugar & Flour',
  'East Side Buns',
  'Crumb Theory',
  'Rise Up Bakehouse',
  'Little Oven',
  'Butter Lane',
  'Cocoa Corner',
  'Oak Hill Pastry',
  'Red Brick Bakery',
  'Morning Loaf',
  'Honey Whisk',
  'Pecan Pie Co',
  'Tres Leches House',
  'Kolache Kitchen',
  'Flour Child',
  'Cake Garden',
  'Rolling Pin',
  'Bread & Bloom',
  'Donut Dynasty',
  'The Proof Box',
  'Sweet Sixth',
  'Lady Bird Cakes',
  'Riverside Rolls',
  'Cinnamon Street',
  'Mesquite Bakery',
  'Dough Bros',
  'Barton Bakes',
  'Zilker Sweets',
] as const;

export interface BakeryFixture {
  readonly i: number;
  readonly placeKey: string;
  readonly name: string;
  readonly slug: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  readonly category: string;
  readonly phone: string;
  readonly website: string | null;
  readonly rating: number;
  readonly reviewsCount: number;
  readonly email: string;
  /** ZeroBounce answers `invalid` for this bakery's emails. */
  readonly emailInvalid: boolean;
  /** Twilio answers `valid: false` for this bakery's phone. */
  readonly phoneInvalid: boolean;
}

export const BAKERIES: readonly BakeryFixture[] = NAMES.map((name, i) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return {
    i,
    placeKey: `google:bakery-${i}`,
    name,
    slug,
    address: `${100 + i * 10} E 6th St, Austin, TX 78702`,
    lat: 30.262 + i * 0.0005,
    lng: -97.726 - i * 0.0005,
    category: i % 5 === 4 ? 'Coffee shop' : 'Bakery',
    phone: `+1512555${1000 + i}`,
    website: i % 6 === 5 ? null : `https://${slug}.example`,
    rating: Math.round((3 + (i % 5) * 0.4) * 10) / 10,
    reviewsCount: 20 + i * 7,
    email: `hello@${slug}.example`,
    emailInvalid: i % 7 === 3,
    phoneInvalid: i % 4 === 3,
  };
});

const bySlug = new Map(BAKERIES.map((b) => [b.slug, b]));

function source(name: string, url: string | null) {
  return { name, url, retrievedAt: '2026-11-19T10:00:00.000Z' };
}

function place(b: BakeryFixture) {
  return {
    placeKey: b.placeKey,
    name: b.name,
    address: b.address,
    lat: b.lat,
    lng: b.lng,
    category: b.category,
    phone: b.phone,
    website: b.website,
    categories: [b.category],
    rating: b.rating,
    reviewCount: b.reviewsCount,
    mapsUrl: `https://maps.example/place/${b.i}`,
    source: source('Google Maps', `https://maps.example/place/${b.i}`),
  };
}

function markdown(b: BakeryFixture): string {
  return [
    `# ${b.name}`,
    `We bake bread, pastries and cakes from scratch every morning in East Austin.`,
    `Contact us: ${b.email} or (512) 555-${1000 + b.i}.`,
    ...(b.i % 2 === 0 ? [`Follow us: https://instagram.com/${b.slug.replaceAll('-', '')}`] : []),
    ...(b.i % 3 === 0 ? [`Reviews: https://yelp.com/biz/${b.slug}-austin`] : []),
  ].join('\n');
}

function slugOfUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\.example.*$/, '');
}

function searchText(input: Record<string, unknown>): string {
  const text = [input.textQuery, input.searchTerm].find((v) => typeof v === 'string');
  if (typeof text === 'string') return text.toLowerCase();
  const tags = Array.isArray(input.tags) ? (input.tags as { value?: unknown }[]) : [];
  return tags.map((t) => (typeof t.value === 'string' ? t.value : '')).join(' ');
}

/** What a fake Tool returns for an input (the tools module's normalised output, FR-24). */
export function fixtureOutput(toolKey: string, input: Record<string, unknown>): unknown {
  switch (toolKey) {
    case 'google.places-text-search':
    case 'apify.google-maps':
    case 'osm.overpass': {
      const hits = /bak|bread|pastr/.test(searchText(input))
        ? BAKERIES
        : BAKERIES.filter((b) => b.i % 3 === 0);
      return { places: hits.map(place), nextPageToken: null };
    }
    case 'firecrawl.scrape': {
      const url = String(input.url);
      const b = bySlug.get(slugOfUrl(url));
      return {
        url,
        title: b?.name ?? null,
        markdown: b ? markdown(b) : '',
        statusCode: 200,
        source: source('Website', url),
      };
    }
    case 'apify.instagram-profile': {
      const username = (input.usernames as string[] | undefined)?.[0] ?? 'unknown';
      const url = `https://instagram.com/${username}`;
      return {
        profiles: [
          {
            username,
            bio: 'Fresh bread daily · wholesale welcome',
            followers: 1200,
            url,
            source: source('Instagram', url),
          },
        ],
      };
    }
    case 'apify.yelp': {
      const url = (input.urls as string[] | undefined)?.[0] ?? '';
      return {
        businesses: [
          {
            url,
            rating: 4.5,
            reviewCount: 210,
            reviewSnippets: ['Best kolaches in town'],
            source: source('Yelp', url),
          },
        ],
      };
    }
    case 'apollo.people-match':
      return {
        person: {
          name: 'Pat Baker',
          title: 'Owner',
          email: `owner@${String(input.domain)}`,
          emailStatus: 'verified',
        },
        source: source('Apollo', null),
      };
    case 'hunter.domain-search':
      return {
        domain: input.domain,
        emails: [{ email: `orders@${String(input.domain)}`, type: 'generic', position: 'Orders' }],
        source: source('Hunter', null),
      };
    case 'zerobounce.validate': {
      const email = String(input.email);
      const b = BAKERIES.find((x) => email.endsWith(`@${x.slug}.example`));
      const invalid = b?.emailInvalid ?? false;
      return {
        email,
        status: invalid ? 'invalid' : 'valid',
        verdict: invalid ? 'invalid' : 'verified',
        source: source('ZeroBounce', null),
      };
    }
    case 'twilio.lookup-line-type': {
      const digits = String(input.phone).replace(/\D/g, '');
      const b = BAKERIES.find(
        (x) => x.phone.replace(/\D/g, '') === digits || digits.endsWith(String(5551000 + x.i)),
      );
      const valid = !(b?.phoneInvalid ?? false);
      return {
        phoneNumber: input.phone,
        valid,
        lineType: 'landline',
        verdict: valid ? 'verified' : 'invalid',
        source: source('Twilio Lookup', null),
      };
    }
    default:
      return {};
  }
}
