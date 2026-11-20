import { ValidationError } from '../../../shared/domain/errors.js';

export const MAX_RADIUS_MILES = 100;

export interface PostalAddress {
  readonly line1: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
}

/** The geocoded point of the Business (FR-14: "a geocoded location"). */
export interface GeoLocation {
  readonly lat: number;
  readonly lng: number;
  readonly label: string;
}

/** The plain fields of a Business Profile (everything but Products). */
export interface ProfileFields {
  readonly description: string | null;
  readonly category: string | null;
  readonly address: PostalAddress;
  readonly location: GeoLocation | null;
  readonly deliveryRadiusMiles: number | null;
  readonly currentCustomers: string | null;
  readonly priceRange: string | null;
  readonly website: string | null;
}

export interface ProfileSnapshot extends ProfileFields {
  readonly businessId: string;
  readonly completedAt: Date | null;
  readonly updatedAt: Date;
}

/** A partial change; `undefined` leaves a field as it is, `null` clears it. */
export type ProfileChanges = Partial<Omit<ProfileFields, 'address'>> & {
  readonly address?: Partial<PostalAddress>;
};

const EMPTY_ADDRESS: PostalAddress = { line1: null, city: null, state: null, postalCode: null };

const limits = {
  description: 500,
  category: 80,
  currentCustomers: 500,
  priceRange: 120,
  website: 2048,
  line1: 200,
  city: 100,
  state: 50,
  postalCode: 20,
} as const;

function cleanText(field: keyof typeof limits, value: string | null): string | null {
  if (value === null) return null;
  const v = value.trim();
  if (v === '') return null;
  if (v.length > limits[field]) {
    throw new ValidationError(`${field} is too long`, {
      [field]: `At most ${limits[field]} characters`,
    });
  }
  return v;
}

function cleanRadius(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > MAX_RADIUS_MILES) {
    throw new ValidationError('Delivery radius must be 0 to 100 miles', {
      deliveryRadiusMiles: 'Must be between 0 and 100 miles',
    });
  }
  return Math.round(value * 10) / 10;
}

function cleanLocation(value: GeoLocation | null): GeoLocation | null {
  if (value === null) return null;
  if (Math.abs(value.lat) > 90 || Math.abs(value.lng) > 180) {
    throw new ValidationError('Location is out of range', { location: 'Invalid coordinates' });
  }
  return {
    lat: Math.round(value.lat * 1e6) / 1e6,
    lng: Math.round(value.lng * 1e6) / 1e6,
    label: value.label.trim().slice(0, 200),
  };
}

/** The address as one line for geocoding, or null when every part is empty. */
export function addressQuery(address: PostalAddress): string | null {
  const parts = [
    address.line1,
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(' '),
  ]
    .map((p) => (p ?? '').trim())
    .filter((p) => p !== '');
  return parts.length === 0 ? null : parts.join(', ');
}

export function sameAddress(a: PostalAddress, b: PostalAddress): boolean {
  const norm = (v: string | null) => (v ?? '').trim().toLowerCase();
  return (
    norm(a.line1) === norm(b.line1) &&
    norm(a.city) === norm(b.city) &&
    norm(a.state) === norm(b.state) &&
    norm(a.postalCode) === norm(b.postalCode)
  );
}

/**
 * FR-14 completeness: at least one Product, a geocoded location and a delivery radius.
 */
export function isProfileComplete(
  fields: Pick<ProfileFields, 'location' | 'deliveryRadiusMiles'>,
  productsCount: number,
): boolean {
  return productsCount >= 1 && fields.location !== null && fields.deliveryRadiusMiles !== null;
}

/** The Business Profile aggregate (one per Business). Products are their own aggregate. */
export class BusinessProfile {
  private constructor(private state: ProfileSnapshot) {}

  static empty(businessId: string, now: Date): BusinessProfile {
    return new BusinessProfile({
      businessId,
      description: null,
      category: null,
      address: EMPTY_ADDRESS,
      location: null,
      deliveryRadiusMiles: null,
      currentCustomers: null,
      priceRange: null,
      website: null,
      completedAt: null,
      updatedAt: now,
    });
  }

  static restore(snapshot: ProfileSnapshot): BusinessProfile {
    return new BusinessProfile({ ...snapshot, address: { ...snapshot.address } });
  }

  get businessId(): string {
    return this.state.businessId;
  }

  get completedAt(): Date | null {
    return this.state.completedAt;
  }

  get fields(): ProfileFields {
    const { businessId: _b, completedAt: _c, updatedAt: _u, ...fields } = this.state;
    return fields;
  }

  /** Applies a partial change, validating every field it touches. */
  change(changes: ProfileChanges, now: Date): void {
    const s = this.state;
    const pick = <K extends keyof typeof limits>(
      field: K,
      next: string | null | undefined,
      current: string | null,
    ) => (next === undefined ? current : cleanText(field, next));
    const address = changes.address ?? {};
    this.state = {
      ...s,
      description: pick('description', changes.description, s.description),
      category: pick('category', changes.category, s.category),
      currentCustomers: pick('currentCustomers', changes.currentCustomers, s.currentCustomers),
      priceRange: pick('priceRange', changes.priceRange, s.priceRange),
      website: pick('website', changes.website, s.website),
      address: {
        line1: pick('line1', address.line1, s.address.line1),
        city: pick('city', address.city, s.address.city),
        state: pick('state', address.state, s.address.state),
        postalCode: pick('postalCode', address.postalCode, s.address.postalCode),
      },
      location: changes.location === undefined ? s.location : cleanLocation(changes.location),
      deliveryRadiusMiles:
        changes.deliveryRadiusMiles === undefined
          ? s.deliveryRadiusMiles
          : cleanRadius(changes.deliveryRadiusMiles),
      updatedAt: now,
    };
  }

  isComplete(productsCount: number): boolean {
    return isProfileComplete(this.state, productsCount);
  }

  /**
   * Records the first time the profile is complete. Returns true only on that first time, so
   * `profile_completed` fires once per Business (PRD section 3a).
   */
  markCompletedIfFirst(productsCount: number, now: Date): boolean {
    if (this.state.completedAt !== null || !this.isComplete(productsCount)) return false;
    this.state = { ...this.state, completedAt: now };
    return true;
  }

  toSnapshot(): ProfileSnapshot {
    return { ...this.state, address: { ...this.state.address } };
  }
}
