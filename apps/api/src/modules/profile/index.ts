import type { FastifyInstance } from 'fastify';
import type { AnalyticsTracker } from '../../shared/application/analytics-tracker.js';
import type { Geocoder } from '../../shared/application/geocoder.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import { SystemClock } from '../../shared/infrastructure/time/system-clock.js';
import {
  noProductUsage,
  type BusinessNames,
  type ProductUsage,
  type ProfileUnitOfWork,
} from './application/ports.js';
import { ProfileService } from './application/profile-use-cases.js';
import { Product } from './domain/product.js';
import { BusinessProfile } from './domain/profile.js';
import { profileRoutes } from './http/profile.routes.js';
import {
  FakeProductUsage,
  InMemoryBusinessNames,
  InMemoryProfileStore,
} from './infrastructure/in-memory-profile.js';
import { kyselyProfileUnitOfWork } from './infrastructure/kysely-profile.js';

export type { BusinessNames, ProductUsage } from './application/ports.js';
export type { CompletionContext, ProfileUpdates } from './application/profile-use-cases.js';
export { FakeProductUsage, InMemoryBusinessNames } from './infrastructure/in-memory-profile.js';

/** Reads for other modules (assistant, planning, research). */
export type ProfileQueries = Pick<ProfileService, 'getProfile' | 'isComplete' | 'listProducts'>;

/**
 * Writes for other modules: the assistant applies the welcome chat's extracted updates
 * (`applyUpdates(businessId, updates, { via: 'chat', messagesCount, memberId })`). New Products
 * whose name the Business already has are skipped; `profile_completed` fires once per Business.
 */
export type ProfileCommands = Pick<ProfileService, 'applyUpdates'>;

/** The HTTP module's shape (matches app.ts AppModule). */
export interface ProfileHttpModule {
  readonly name: 'profile';
  register(app: FastifyInstance): void;
}

export interface Profile {
  module: ProfileHttpModule;
  profileQueries: ProfileQueries;
  profileCommands: ProfileCommands;
  /** Every use case (seed, tests). */
  service: ProfileService;
}

interface CommonDeps {
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  /** Geocodes a changed address (FR-15); Google in production, fixtures in tests. */
  geocoder: Geocoder;
  /** identity's Business name: `getBusiness(id)?.name` and `renameBusiness(id, name)`. */
  businesses: BusinessNames;
  /** planning's "a Plan segment pitches it" check; nothing is in use when absent. */
  productUsage?: ProductUsage;
}

const noGeocoder: Geocoder = { search: () => Promise.resolve([]) };

function assemble(uow: ProfileUnitOfWork, deps: CommonDeps): Profile {
  const service = new ProfileService({
    ...deps,
    uow,
    productUsage: deps.productUsage ?? noProductUsage,
  });
  return {
    service,
    profileQueries: {
      getProfile: service.getProfile.bind(service),
      isComplete: service.isComplete.bind(service),
      listProducts: service.listProducts.bind(service),
    },
    profileCommands: { applyUpdates: service.applyUpdates.bind(service) },
    module: { name: 'profile', register: (app) => profileRoutes(app, { profile: service }) },
  };
}

/** profile: Business Profile and Products (FR-14, FR-15) on MySQL. */
export function createProfile(deps: CommonDeps & { db: Database }): Profile {
  return assemble(kyselyProfileUnitOfWork(deps.db), deps);
}

/** Only the reads, for modules that don't write the profile. */
export function createProfileQueries(
  deps: Pick<CommonDeps, 'clock' | 'ids' | 'businesses'> & { db: Database },
): ProfileQueries {
  return createProfile({
    ...deps,
    analytics: { track: () => Promise.resolve() },
    geocoder: noGeocoder,
  }).profileQueries;
}

/** Only the writes other modules use (the assistant's applyUpdates). */
export function createProfileCommands(
  deps: Omit<CommonDeps, 'geocoder' | 'productUsage'> & { db: Database },
): ProfileCommands {
  return createProfile({ ...deps, geocoder: noGeocoder }).profileCommands;
}

/** The same module on in-memory storage, for other modules' tests. */
export function createInMemoryProfile(
  deps: Partial<CommonDeps> & Pick<CommonDeps, 'clock' | 'ids'>,
): Profile & {
  store: InMemoryProfileStore;
  names: InMemoryBusinessNames;
  usage: FakeProductUsage;
} {
  const store = new InMemoryProfileStore();
  const names = new InMemoryBusinessNames();
  const usage = new FakeProductUsage();
  const profile = assemble(store, {
    analytics: { track: () => Promise.resolve() },
    geocoder: noGeocoder,
    businesses: names,
    productUsage: usage,
    ...deps,
  });
  return { ...profile, store, names, usage };
}

/**
 * Placeholder kept so composition.ts compiles until it registers `createProfile(...).module`
 * instead.
 */
export const profileModule = {
  name: 'profile',
  register(_app: FastifyInstance): void {
    // Replaced by createProfile(...).module in the composition root.
  },
};

/** Fixed ids the seed shares across modules (scripts/seed.ts `demo`). */
interface DemoIds {
  businesses: { sweetSupply: string; cleanDesk: string; cornerCoffee: string };
  products: {
    caneSugar: string;
    powderedSugar: string;
    espressoBeans: string;
    brownSugar?: string;
  };
}

/** Used until scripts/seed.ts registers `demo.products.brownSugar`. */
const BROWN_SUGAR_ID = '00000000-0000-7000-8000-00000000d204';

interface SeedProfile {
  businessId: string;
  description: string;
  category: string;
  address: { line1: string; city: string; state: string; postalCode: string };
  location: { lat: number; lng: number; label: string };
  deliveryRadiusMiles: number;
  currentCustomers: string;
  priceRange: string;
  website: string | null;
  products: { id: string; name: string; description: string }[];
}

function demoProfiles(demo: DemoIds): SeedProfile[] {
  return [
    {
      businessId: demo.businesses.sweetSupply,
      description: 'Wholesale sugar distributor for food businesses in Austin.',
      category: 'Food wholesale',
      address: { line1: '1200 E 6th St', city: 'Austin', state: 'TX', postalCode: '78702' },
      location: { lat: 30.2624, lng: -97.7262, label: '1200 E 6th St, Austin, TX 78702' },
      deliveryRadiusMiles: 3,
      currentCustomers: 'Restaurants',
      priceRange: '$30–$60 per bag',
      website: null,
      products: [
        { id: demo.products.caneSugar, name: 'Cane sugar, 50 lb bag', description: '' },
        { id: demo.products.powderedSugar, name: 'Powdered sugar, 25 lb bag', description: '' },
        {
          id: demo.products.brownSugar ?? BROWN_SUGAR_ID,
          name: 'Brown sugar, 50 lb bag',
          description: '',
        },
      ],
    },
    {
      businessId: demo.businesses.cornerCoffee,
      description: 'Small-batch coffee roaster supplying cafés.',
      category: 'Coffee roaster',
      address: {
        line1: '2400 E Cesar Chavez St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78702',
      },
      location: { lat: 30.2556, lng: -97.7155, label: '2400 E Cesar Chavez St, Austin, TX 78702' },
      deliveryRadiusMiles: 5,
      currentCustomers: 'Cafés and offices',
      priceRange: '$12–$18 per lb',
      website: null,
      products: [
        { id: demo.products.espressoBeans, name: 'Espresso beans, 5 lb bag', description: '' },
      ],
    },
  ];
}

/**
 * Demo data (PRD section 8a), idempotent: complete profiles for Sweet Supply Co (1200 E 6th St
 * Austin TX, 3 miles, cane / powdered / brown sugar, sells to restaurants) and Corner Coffee
 * Roasters; Clean Desk Co keeps an empty profile (welcome chat start). No analytics events.
 */
export async function seed(deps: { db: Database; clock?: Clock; demo: DemoIds }): Promise<void> {
  const clock = deps.clock ?? new SystemClock();
  const uow = kyselyProfileUnitOfWork(deps.db);
  const now = clock.now();
  for (const p of demoProfiles(deps.demo)) {
    await uow.run(async (repos) => {
      const profile =
        (await repos.profiles.find(p.businessId)) ?? BusinessProfile.empty(p.businessId, now);
      profile.change(
        {
          description: p.description,
          category: p.category,
          address: p.address,
          location: p.location,
          deliveryRadiusMiles: p.deliveryRadiusMiles,
          currentCustomers: p.currentCustomers,
          priceRange: p.priceRange,
          website: p.website,
        },
        now,
      );
      for (const product of p.products) {
        const existing = await repos.products.find(p.businessId, product.id);
        if (existing) continue;
        await repos.products.save(
          p.businessId,
          Product.create({ ...product, businessId: p.businessId, now }),
        );
      }
      profile.markCompletedIfFirst(p.products.length, now);
      await repos.profiles.save(profile);
    });
  }
}
