import type {
  Product as ProductView,
  Profile,
  ProfileInput,
  ProductInput,
} from '@app/contracts/profile';
import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Geocoder } from '../../../shared/application/geocoder.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { CodedError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { Product } from '../domain/product.js';
import {
  addressQuery,
  BusinessProfile,
  sameAddress,
  type ProfileChanges,
} from '../domain/profile.js';
import type { BusinessNames, ProductUsage, ProfileRepos, ProfileUnitOfWork } from './ports.js';

export interface ProfileDeps {
  uow: ProfileUnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  geocoder: Geocoder;
  businesses: BusinessNames;
  productUsage: ProductUsage;
}

/** Changes the assistant extracts from the welcome chat (FR-14), applied through profile. */
export interface ProfileUpdates extends ProfileChanges {
  /** New Products; a name the Business already has is skipped. */
  readonly addProducts?: readonly { readonly name: string; readonly description?: string }[];
}

/** How the profile got complete, for `profile_completed` (PRD section 3a). */
export interface CompletionContext {
  readonly via: 'chat' | 'manual';
  readonly messagesCount: number;
  readonly memberId?: string;
}

/** Owner of the Business, or Staff Acting as it (the Actor then carries `owner` too). */
function requireOwner(actor: Actor): void {
  if (!actor.roles.includes('owner')) throw new ForbiddenError('Only the Owner can do this');
}

function productView(p: Product): ProductView {
  const s = p.toSnapshot();
  return { id: s.id, name: s.name, description: s.description };
}

function profileView(
  name: string,
  profile: BusinessProfile,
  products: readonly Product[],
): Profile {
  const f = profile.fields;
  return {
    businessName: name,
    description: f.description,
    category: f.category,
    address: { ...f.address, country: 'US' },
    location: f.location,
    deliveryRadiusMiles: f.deliveryRadiusMiles,
    currentCustomers: f.currentCustomers,
    priceRange: f.priceRange,
    website: f.website,
    products: products.map(productView),
    complete: profile.isComplete(products.length),
  };
}

async function loadOrEmpty(repos: ProfileRepos, businessId: string, now: Date) {
  return (await repos.profiles.find(businessId)) ?? BusinessProfile.empty(businessId, now);
}

/** Profile reads and writes (FR-14, FR-15). */
export class ProfileService {
  constructor(private readonly deps: ProfileDeps) {}

  private async businessName(businessId: string): Promise<string> {
    return (await this.deps.businesses.getName(businessId)) ?? '';
  }

  /** The Profile of a Business; an empty one when nothing was saved yet. */
  async getProfile(businessId: string): Promise<Profile> {
    const { uow, clock } = this.deps;
    const [name, loaded] = await Promise.all([
      this.businessName(businessId),
      uow.run(async (repos) => ({
        profile: await loadOrEmpty(repos, businessId, clock.now()),
        products: await repos.products.list(businessId),
      })),
    ]);
    return profileView(name, loaded.profile, loaded.products);
  }

  async isComplete(businessId: string): Promise<boolean> {
    return (await this.getProfile(businessId)).complete;
  }

  async listProducts(businessId: string): Promise<ProductView[]> {
    return this.deps.uow.run(async (repos) =>
      (await repos.products.list(businessId)).map(productView),
    );
  }

  /** GET /api/profile. */
  async view(actor: Actor): Promise<Profile> {
    requireOwner(actor);
    return await this.getProfile(actor.businessId);
  }

  /**
   * Applies partial changes and new Products in one transaction, then fires `profile_completed`
   * the first time the profile is complete. Used by the assistant (FR-14) and the manual edit.
   */
  async applyUpdates(
    businessId: string,
    updates: ProfileUpdates,
    context: CompletionContext = { via: 'chat', messagesCount: 0 },
  ): Promise<{ profile: Profile; completedNow: boolean }> {
    const { uow, clock, ids } = this.deps;
    const now = clock.now();
    const { addProducts = [], ...changes } = updates;
    const result = await uow.run(async (repos) => {
      const profile = await loadOrEmpty(repos, businessId, now);
      profile.change(changes, now);
      const products = await repos.products.list(businessId);
      for (const input of addProducts) {
        if (products.some((p) => p.hasName(input.name))) continue;
        const product = Product.create({
          id: ids.next(),
          businessId,
          name: input.name,
          description: input.description ?? '',
          now,
        });
        await repos.products.save(businessId, product);
        products.push(product);
      }
      const completedNow = profile.markCompletedIfFirst(products.length, now);
      await repos.profiles.save(profile);
      return { profile, products, completedNow };
    });
    if (result.completedNow) await this.trackCompleted(businessId, context);
    const name = await this.businessName(businessId);
    return {
      profile: profileView(name, result.profile, result.products),
      completedNow: result.completedNow,
    };
  }

  /** PUT /api/profile (FR-15): every field; a changed address is geocoded; renames the Business. */
  async update(actor: Actor, input: ProfileInput): Promise<Profile> {
    requireOwner(actor);
    const { businessId } = actor;
    const current = await this.deps.uow.run((repos) =>
      loadOrEmpty(repos, businessId, this.deps.clock.now()),
    );
    const address = {
      line1: input.address.line1,
      city: input.address.city,
      state: input.address.state,
      postalCode: input.address.postalCode,
    };
    const changes: ProfileChanges = {
      description: input.description,
      category: input.category,
      address,
      deliveryRadiusMiles: input.deliveryRadiusMiles,
      currentCustomers: input.currentCustomers,
      priceRange: input.priceRange,
      website: input.website,
    };
    const addressChanged = !sameAddress(current.fields.address, address);
    const location =
      addressChanged || current.fields.location === null
        ? await this.geocodeAddress(addressQuery(address), addressChanged)
        : undefined;

    const name = (await this.businessName(businessId)).trim();
    if (input.businessName.trim() !== name) {
      await this.deps.businesses.rename(businessId, input.businessName);
    }
    const { profile } = await this.applyUpdates(
      businessId,
      location === undefined ? changes : { ...changes, location },
      { via: 'manual', messagesCount: 0, memberId: actor.memberId },
    );
    return profile;
  }

  /**
   * The point for an address: null for an empty address; ADDRESS_NOT_FOUND when a changed
   * address has no match (an unchanged one without a location just stays without one).
   */
  private async geocodeAddress(query: string | null, required: boolean) {
    if (query === null) return null;
    const [first] = await this.deps.geocoder.search(query, 1);
    if (!first) {
      if (!required) return undefined;
      throw new CodedError('ADDRESS_NOT_FOUND', "We couldn't find that address", {
        query,
      });
    }
    return { lat: first.lat, lng: first.lng, label: first.label };
  }

  async createProduct(actor: Actor, input: ProductInput): Promise<ProductView> {
    requireOwner(actor);
    const { businessId } = actor;
    const { uow, clock, ids } = this.deps;
    const now = clock.now();
    const result = await uow.run(async (repos) => {
      const product = Product.create({
        id: ids.next(),
        businessId,
        name: input.name,
        description: input.description ?? '',
        now,
      });
      await repos.products.save(businessId, product);
      const profile = await loadOrEmpty(repos, businessId, now);
      const count = (await repos.products.list(businessId)).length;
      const completedNow = profile.markCompletedIfFirst(count, now);
      if (completedNow) await repos.profiles.save(profile);
      return { product, completedNow };
    });
    if (result.completedNow) {
      await this.trackCompleted(businessId, {
        via: 'manual',
        messagesCount: 0,
        memberId: actor.memberId,
      });
    }
    return productView(result.product);
  }

  async updateProduct(actor: Actor, id: string, input: ProductInput): Promise<ProductView> {
    requireOwner(actor);
    return this.deps.uow.run(async (repos) => {
      const product = await repos.products.find(actor.businessId, id);
      if (!product) throw new NotFoundError('Product not found', { id });
      product.rename(input.name, input.description ?? '');
      await repos.products.save(actor.businessId, product);
      return productView(product);
    });
  }

  /** FR-15: a Product pitched by a Plan segment can't be deleted (409 PRODUCT_IN_USE). */
  async deleteProduct(actor: Actor, id: string): Promise<void> {
    requireOwner(actor);
    const { businessId } = actor;
    await this.deps.uow.run(async (repos) => {
      const product = await repos.products.find(businessId, id);
      if (!product) throw new NotFoundError('Product not found', { id });
      if (await this.deps.productUsage.isInUse(businessId, id)) {
        throw new CodedError('PRODUCT_IN_USE', 'Remove it from your plans first', { id });
      }
      await repos.products.remove(businessId, id);
    });
  }

  private async trackCompleted(businessId: string, context: CompletionContext): Promise<void> {
    await this.deps.analytics.track({
      name: 'profile_completed',
      ...(context.memberId ? { actor: { memberId: context.memberId, businessId } } : {}),
      properties: {
        business_id: businessId,
        via: context.via,
        messages_count: context.messagesCount,
      },
    });
  }
}
