/**
 * Invented Austin businesses for the fake Tools (TOOLS_MODE=fake, tests, e2e; PRD section 11).
 * 30 bakeries, cafés and dessert shops and 10 coffee shops around Sweet Supply Co
 * (1200 E 6th St, 30.2624,-97.7262). Every name, phone (512-555-01xx), website (*.example) and
 * email is made up; no real business or person.
 */
export type FakeKind = 'bakery' | 'cafe' | 'dessert' | 'coffee';

export interface FakeBusiness {
  readonly slug: string;
  readonly name: string;
  readonly kind: FakeKind;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  readonly phone: string;
  readonly website: string | null;
  readonly instagram: string | null;
  readonly yelp: boolean;
  /** A business email published on the website, or null. */
  readonly email: string | null;
  readonly owner: string | null;
  readonly rating: number;
  readonly reviews: number;
  /** The fake Google place id (`google:<placeId>`). */
  readonly placeId: string;
  /** Present in OpenStreetMap too. */
  readonly osm: boolean;
}

export const CENTER = { lat: 30.2624, lng: -97.7262 } as const;

const NAMES: readonly [string, FakeKind, string | null][] = [
  ['Crumb & Co Bakery', 'bakery', 'Maya Torres'],
  ['Eastside Sourdough', 'bakery', 'Ben Alvarez'],
  ['Golden Crust Bakehouse', 'bakery', 'Lena Park'],
  ['Little Oven Bakery', 'bakery', null],
  ['Rise & Shine Breads', 'bakery', 'Omar Haddad'],
  ['Pecan Street Pastry', 'bakery', 'Claire Dubois'],
  ['Flour Child Bakery', 'bakery', 'Rosa Medina'],
  ['Hill Country Kolaches', 'bakery', 'Jan Novak'],
  ['Morning Bun Bakery', 'bakery', null],
  ['Bluebonnet Bread Co', 'bakery', 'Tess Walker'],
  ['Sugar Mill Patisserie', 'bakery', 'Henri Laurent'],
  ['Rolling Pin Bakeshop', 'bakery', 'Dana Kim'],
  ['Cedar Avenue Bakery', 'bakery', null],
  ['Twisted Croissant', 'bakery', 'Nico Rossi'],
  ['Hearth & Honey Bakery', 'bakery', 'Ivy Chen'],
  ['Lady Bird Cafe', 'cafe', 'Sam Ortiz'],
  ['Colorado River Cafe', 'cafe', null],
  ['Rainey Street Kitchen & Bakery', 'cafe', 'Grace Lee'],
  ['Barton Creek Brunch House', 'cafe', 'Luis Romero'],
  ['Tejano Table Cafe', 'cafe', 'Ana Flores'],
  ['Greenbelt Cafe & Bakery', 'cafe', null],
  ['Zilker Corner Cafe', 'cafe', 'Paul Meyer'],
  ['Frosted Fig Cupcakes', 'dessert', 'Kara Jones'],
  ['Pie Society Austin', 'dessert', 'Will Grant'],
  ['Cloud Nine Donuts', 'dessert', null],
  ['Tres Leches House', 'dessert', 'Marisol Vega'],
  ['Macaron Lane', 'dessert', 'Elise Martin'],
  ['Scoop & Crumble', 'dessert', 'Jake Hill'],
  ['Cinnamon Swirl Shop', 'dessert', null],
  ['Velvet Cake Studio', 'dessert', 'Nora Bell'],
  ['Bean There Coffee', 'coffee', 'Ray Patel'],
  ['Mesquite Roast House', 'coffee', null],
  ['Third Coast Espresso', 'coffee', 'Kim Nguyen'],
  ['Cesar Chavez Coffee Bar', 'coffee', 'Diego Ruiz'],
  ['Pour Over Collective', 'coffee', null],
  ['Riverside Grind', 'coffee', 'Amy Ross'],
  ['Lamar Latte Lab', 'coffee', 'Theo Brooks'],
  ['Moonlight Coffee Co', 'coffee', null],
  ['Holly Street Beans', 'coffee', 'Sara Lopez'],
  ['Congress Cup', 'coffee', 'Max Weber'],
];

const STREETS = [
  'E 6th St',
  'E Cesar Chavez St',
  'Manor Rd',
  'E 7th St',
  'Holly St',
  'E 11th St',
  'Webberville Rd',
  'S Congress Ave',
  'E Riverside Dr',
  'N Lamar Blvd',
];

function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Deterministic offsets within about 2.8 miles of the centre. */
function offset(i: number): { lat: number; lng: number } {
  const angle = (i * 137.508 * Math.PI) / 180;
  const radius = 0.006 + ((i * 7) % 30) * 0.0012;
  return {
    lat: Math.round((CENTER.lat + radius * Math.sin(angle)) * 1e6) / 1e6,
    lng: Math.round((CENTER.lng + radius * Math.cos(angle)) * 1e6) / 1e6,
  };
}

export const FAKE_BUSINESSES: readonly FakeBusiness[] = NAMES.map(([name, kind, owner], i) => {
  const slug = slugOf(name);
  const n = i + 1;
  const hasWebsite = n % 6 !== 0;
  const { lat, lng } = offset(n);
  return {
    slug,
    name,
    kind,
    address: `${100 + n * 37} ${STREETS[i % STREETS.length] ?? 'E 6th St'}, Austin, TX 787${String(n % 50).padStart(2, '0')}`,
    lat,
    lng,
    phone: `512-555-01${String(n).padStart(2, '0')}`,
    website: hasWebsite ? `https://${slug}.example` : null,
    instagram: n % 3 !== 0 ? slug.replace(/-/g, '').slice(0, 24) : null,
    yelp: n % 4 !== 0,
    email: hasWebsite && n % 5 !== 0 ? `hello@${slug}.example` : null,
    owner,
    rating: Math.round((3.8 + ((n * 3) % 12) / 10) * 10) / 10,
    reviews: 20 + ((n * 53) % 400),
    placeId: `ChIJfake${String(n).padStart(4, '0')}${slug.slice(0, 8).replace(/-/g, '')}`,
    osm: n % 2 === 0,
  };
});

export function fakeBusinessesOf(kinds: readonly FakeKind[]): FakeBusiness[] {
  return FAKE_BUSINESSES.filter((b) => kinds.includes(b.kind));
}

/** Words that pick coffee shops; anything else returns bakeries, cafés and dessert shops. */
export function kindsForQuery(query: string): FakeKind[] {
  return /coffee|espresso|roast|latte/i.test(query) ? ['coffee'] : ['bakery', 'cafe', 'dessert'];
}

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
