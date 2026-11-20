import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { FixtureGeocoder } from '../../../shared/infrastructure/geo/fixture-geocoder.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { createInMemoryProfile } from '../index.js';

export const BUSINESS = '00000000-0000-7000-8000-00000000b001';
export const OTHER_BUSINESS = '00000000-0000-7000-8000-00000000b002';
export const OWNER_ID = '00000000-0000-7000-8000-00000000c001';
export const STAFF_ID = '00000000-0000-7000-8000-00000000c002';

export function owner(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: OWNER_ID,
    businessId: BUSINESS,
    roles: ['owner'],
    emailVerified: false,
    ...overrides,
  };
}

/** Staff Acting as BUSINESS (FR-6): the Actor carries `owner` for that Business. */
export function actingAs(): Actor {
  return {
    memberId: STAFF_ID,
    businessId: BUSINESS,
    roles: ['owner', 'staff'],
    emailVerified: true,
    actingAs: { businessId: BUSINESS, businessName: 'Sweet Supply Co', staffMemberId: STAFF_ID },
  };
}

export const austinInput = {
  businessName: 'Sweet Supply Co',
  description: 'Sugar wholesaler',
  category: 'Food wholesale',
  address: {
    line1: '1200 E 6th St',
    city: 'Austin',
    state: 'TX',
    postalCode: '78702',
    country: 'US' as const,
  },
  deliveryRadiusMiles: 3,
  currentCustomers: 'Restaurants',
  priceRange: null,
  website: null,
};

/** The profile module on in-memory storage, the fixture geocoder and a recording tracker. */
export function profileFixture() {
  const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
  const analytics = new RecordingAnalyticsTracker();
  const profile = createInMemoryProfile({
    clock,
    ids: new SequentialIdGenerator(),
    analytics,
    geocoder: new FixtureGeocoder(),
  });
  profile.names.names.set(BUSINESS, 'Sweet Supply Co');
  profile.names.names.set(OTHER_BUSINESS, 'Clean Desk Co');
  return { ...profile, clock, analytics };
}
