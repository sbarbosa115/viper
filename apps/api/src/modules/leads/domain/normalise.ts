/** Normalisation for merging Prospects (FR-19 Step 3) and matching Contacts. Pure functions. */

/** Hosts that are not a business's own website (a profile on another site, a link page). */
const SHARED_HOSTS = [
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'yelp.com',
  'google.com',
  'goo.gl',
  'linktr.ee',
  'x.com',
  'twitter.com',
  'youtube.com',
  'doordash.com',
  'ubereats.com',
  'grubhub.com',
  'square.site',
  'wixsite.com',
  'business.site',
];

/**
 * A phone number as `+<digits>`: 10 US digits become `+1…`, 11 digits starting with 1 too.
 * Null when it has fewer than 7 digits (not a phone number).
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (raw.trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

/** The registrable host of a website (`www.` dropped, lowercase); null for shared hosts. */
export function domainOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
      .hostname;
  } catch {
    return null;
  }
  host = host
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  if (!host.includes('.')) return null;
  if (SHARED_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) return null;
  return host;
}

const NAME_NOISE = new Set(['the', 'llc', 'inc', 'co', 'company', 'ltd', 'corp']);

/** A business name for comparison: no accents, case, punctuation or legal suffixes. */
export function normaliseName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !NAME_NOISE.has(w))
    .join(' ');
}

/** A Contact value for de-duplication (emails and links lowercased, phones normalised). */
export function contactKey(type: string, value: string): string {
  const v = value.trim();
  if (type === 'phone') return `phone:${normalisePhone(v) ?? v}`;
  if (type === 'email') return `email:${v.toLowerCase()}`;
  return `${type}:${v
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')}`;
}

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_MILE = 1609.344;

export interface Point {
  readonly lat: number;
  readonly lng: number;
}

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance in miles, rounded to 2 decimals (the `distance_miles` column). */
export function distanceMiles(a: Point, b: Point): number {
  return Math.round((distanceMeters(a, b) / METERS_PER_MILE) * 100) / 100;
}

/** Cuts text to `max` characters (database column limits), trimming whitespace. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
