import type { ContactInput, EvidenceItem, ProspectInput, SourceRef } from '../domain/prospect.js';

/**
 * The demo run's places for "Bakeries near Austin" (PRD section 8a): 25 that qualify (mixed Fit
 * scores) and 5 that don't (below the minimum, a home listing, only an invalid email, only an
 * unverified email, not scored). Every name, phone (512-555-01xx) and *.example domain is invented.
 */
export interface DemoPlace {
  readonly name: string;
  readonly category: string;
  readonly fitScore: number | null;
  readonly listing?: 'home';
  /** How its email checked out; `none` = no email found. */
  readonly email: 'verified' | 'unverified' | 'invalid' | 'none';
  /** Whether the phone checked out (Twilio); false leaves it "Not verified". */
  readonly phoneVerified: boolean;
  readonly instagram?: boolean;
  readonly signal: string;
}

export const DEMO_PLACES: readonly DemoPlace[] = [
  {
    name: 'Sweet Crumbs Bakery',
    category: 'Bakery',
    fitScore: 92,
    email: 'verified',
    phoneVerified: true,
    instagram: true,
    signal: 'Bakes bread and pastries on site every morning',
  },
  {
    name: 'Golden Crust Bakehouse',
    category: 'Bakery',
    fitScore: 90,
    email: 'verified',
    phoneVerified: true,
    signal: 'Wholesale bread for 12 local cafés',
  },
  {
    name: 'Flour & Fig',
    category: 'Bakery',
    fitScore: 88,
    email: 'verified',
    phoneVerified: true,
    instagram: true,
    signal: 'Seasonal fruit tarts and cakes made in house',
  },
  {
    name: 'Zilker Donut Shop',
    category: 'Donut shop',
    fitScore: 86,
    email: 'unverified',
    phoneVerified: true,
    signal: 'Fries and glazes 40 dozen donuts a day',
  },
  {
    name: 'Barton Hills Pâtisserie',
    category: 'Pâtisserie',
    fitScore: 84,
    email: 'verified',
    phoneVerified: false,
    instagram: true,
    signal: 'French pastries and macarons baked daily',
  },
  {
    name: 'Bluebonnet Bread Co',
    category: 'Bakery',
    fitScore: 83,
    email: 'verified',
    phoneVerified: true,
    signal: 'Sourdough and sweet rolls, open six days',
  },
  {
    name: 'South Congress Sweets',
    category: 'Dessert shop',
    fitScore: 81,
    email: 'verified',
    phoneVerified: true,
    instagram: true,
    signal: 'Cookies and brownies made on site',
  },
  {
    name: 'Rise & Shine Café',
    category: 'Café',
    fitScore: 79,
    email: 'verified',
    phoneVerified: true,
    signal: 'Bakes its own muffins and scones each morning',
  },
  {
    name: 'The Rolling Pin',
    category: 'Bakery',
    fitScore: 78,
    email: 'none',
    phoneVerified: true,
    signal: 'Custom cakes to order',
  },
  {
    name: 'Lady Bird Cupcakes',
    category: 'Dessert shop',
    fitScore: 77,
    email: 'verified',
    phoneVerified: true,
    instagram: true,
    signal: 'Two dozen cupcake flavours, frosted in house',
  },
  {
    name: 'Eastside Cake Co',
    category: 'Bakery',
    fitScore: 76,
    email: 'verified',
    phoneVerified: false,
    signal: 'Wedding and party cakes, baked to order',
  },
  {
    name: 'Mueller Morning Bakery',
    category: 'Bakery',
    fitScore: 74,
    email: 'verified',
    phoneVerified: true,
    signal: 'Kolaches and cinnamon rolls from 6 am',
  },
  {
    name: 'Cedar & Sugar',
    category: 'Café',
    fitScore: 73,
    email: 'unverified',
    phoneVerified: true,
    signal: 'Pastry case restocked twice a day',
  },
  {
    name: 'Little Loaf',
    category: 'Bakery',
    fitScore: 71,
    email: 'verified',
    phoneVerified: true,
    signal: 'Small-batch breads, independent',
  },
  {
    name: 'Hill Country Kolaches',
    category: 'Bakery',
    fitScore: 70,
    email: 'verified',
    phoneVerified: false,
    signal: 'Sweet and savoury kolaches baked on site',
  },
  {
    name: 'Riverside Croissanterie',
    category: 'Bakery',
    fitScore: 69,
    email: 'verified',
    phoneVerified: true,
    signal: 'Laminated pastries made daily',
  },
  {
    name: 'Pecan Street Pies',
    category: 'Pie shop',
    fitScore: 68,
    email: 'verified',
    phoneVerified: true,
    signal: 'Pecan and fruit pies baked daily',
  },
  {
    name: 'Holly Street Bakeshop',
    category: 'Bakery',
    fitScore: 67,
    email: 'none',
    phoneVerified: true,
    signal: 'Cookies and bars for local coffee shops',
  },
  {
    name: 'Clarksville Cookie Co',
    category: 'Dessert shop',
    fitScore: 66,
    email: 'verified',
    phoneVerified: true,
    signal: 'Cookie delivery business with a storefront',
  },
  {
    name: 'Cherrywood Crumb',
    category: 'Café',
    fitScore: 65,
    email: 'verified',
    phoneVerified: false,
    signal: 'Coffee shop with a small in-house bakery',
  },
  {
    name: 'Magnolia Dessert Bar',
    category: 'Dessert shop',
    fitScore: 64,
    email: 'verified',
    phoneVerified: true,
    instagram: true,
    signal: 'Plated desserts in the evening',
  },
  {
    name: 'Brushy Creek Biscuits',
    category: 'Café',
    fitScore: 63,
    email: 'unverified',
    phoneVerified: true,
    signal: 'Biscuits and sweet jams for brunch',
  },
  {
    name: 'Travis Heights Tarts',
    category: 'Bakery',
    fitScore: 62,
    email: 'verified',
    phoneVerified: true,
    signal: 'Tarts and quiches for catering',
  },
  {
    name: 'Windsor Park Waffles & Cakes',
    category: 'Café',
    fitScore: 61,
    email: 'verified',
    phoneVerified: false,
    signal: 'Waffles and layer cakes',
  },
  {
    name: 'Saltillo Sugar Studio',
    category: 'Dessert shop',
    fitScore: 60,
    email: 'verified',
    phoneVerified: true,
    signal: 'Decorated sugar cookies to order',
  },
  // Not delivered (FR-25):
  {
    name: 'Cesar Chavez Churros',
    category: 'Food truck',
    fitScore: 58,
    email: 'verified',
    phoneVerified: true,
    signal: 'Fried churros, buys sugar from a chain',
  },
  {
    name: 'Oak Hill Home Baker',
    category: 'Bakery',
    fitScore: 80,
    listing: 'home',
    email: 'verified',
    phoneVerified: true,
    signal: 'Bakes from home',
  },
  {
    name: 'Dove Springs Donuts',
    category: 'Donut shop',
    fitScore: 85,
    email: 'invalid',
    phoneVerified: false,
    signal: 'Donuts and kolaches',
  },
  {
    name: 'Montopolis Panadería',
    category: 'Bakery',
    fitScore: 72,
    email: 'unverified',
    phoneVerified: false,
    signal: 'Pan dulce baked daily',
  },
  {
    name: 'Crestview Confections',
    category: 'Candy shop',
    fitScore: null,
    email: 'verified',
    phoneVerified: true,
    signal: 'Hand-made candy',
  },
];

/** Feedback on 5 of the Leads (PRD section 8a). */
export const DEMO_FEEDBACK: readonly {
  name: string;
  value: 'good' | 'not_fit';
  reason?: string;
}[] = [
  { name: 'Sweet Crumbs Bakery', value: 'good' },
  { name: 'Flour & Fig', value: 'good' },
  { name: 'Barton Hills Pâtisserie', value: 'good' },
  { name: 'Little Loaf', value: 'not_fit', reason: 'Too far' },
  { name: 'Magnolia Dessert Bar', value: 'not_fit', reason: 'Closed' },
];

const MILES_PER_DEGREE_LAT = 69;

const demoPhone = (index: number) => `512-555-01${(index + 1).toString().padStart(2, '0')}`;

function domainOf(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
  return `${slug}.example`;
}

/** The place as the Maps step found it, spread within 3 miles of `centre`. */
export function demoProspectInput(
  place: DemoPlace,
  index: number,
  centre: { lat: number; lng: number },
  retrievedAt: string,
): ProspectInput {
  const angle = (index * 137.5 * Math.PI) / 180;
  const miles = 0.3 + (index % 10) * 0.27;
  const lat = centre.lat + (miles * Math.sin(angle)) / MILES_PER_DEGREE_LAT;
  const lng =
    centre.lng +
    (miles * Math.cos(angle)) / (MILES_PER_DEGREE_LAT * Math.cos((centre.lat * Math.PI) / 180));
  return {
    name: place.name,
    address: `${100 + index * 37} ${['E 6th St', 'S Congress Ave', 'Manor Rd', 'S Lamar Blvd', 'E Cesar Chavez St'][index % 5]}, Austin, TX`,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    category: place.category,
    phone: demoPhone(index),
    website: `https://${domainOf(place.name)}`,
    placeKeys: [`google:demo-bakery-${index + 1}`],
    source: {
      name: 'Google Maps',
      url: `https://maps.example/place/demo-bakery-${index + 1}`,
      retrievedAt,
    },
    ...(place.listing ? { listing: place.listing } : {}),
  };
}

/** What Steps 5–9 found for the place: Contacts with their checks, Evidence and the Pitch. */
export function demoEnrichment(
  place: DemoPlace,
  index: number,
  retrievedAt: string,
  product: { id: string; name: string },
) {
  const domain = domainOf(place.name);
  const site: SourceRef = { name: 'Website', url: `https://${domain}`, retrievedAt };
  const zeroBounce: SourceRef = { name: 'ZeroBounce', url: null, retrievedAt };
  const twilio: SourceRef = { name: 'Twilio Lookup', url: null, retrievedAt };
  const maps: SourceRef = {
    name: 'Google Maps',
    url: `https://maps.example/search/${domain}`,
    retrievedAt,
  };
  const contacts: ContactInput[] = [];
  if (place.email !== 'none') {
    contacts.push({
      type: 'email',
      value: `hello@${domain}`,
      verification: place.email,
      source: place.email === 'unverified' ? site : zeroBounce,
      checked: place.email !== 'unverified',
    });
  }
  if (place.phoneVerified) {
    contacts.push({
      type: 'phone',
      value: demoPhone(index),
      verification: 'verified',
      source: twilio,
      checked: true,
    });
  }
  const evidence: EvidenceItem[] = [
    { fact: place.signal, points: 20, source: site },
    { fact: 'Independent, one location', points: 10, source: maps },
  ];
  if (place.instagram) {
    const handle = domain.replace('.example', '');
    contacts.push({
      type: 'instagram',
      value: `https://instagram.example/${handle}`,
      verification: 'verified',
      source: { name: 'Instagram', url: `https://instagram.example/${handle}`, retrievedAt },
    });
    evidence.push({
      fact: 'Posts new bakes on Instagram most days',
      points: 8,
      source: { name: 'Instagram', url: `https://instagram.example/${handle}`, retrievedAt },
    });
  }
  return {
    contacts,
    evidence,
    pitch: {
      productId: product.id,
      productName: product.name,
      reason: `${place.signal}, so they go through sugar every day.`,
    },
  };
}
