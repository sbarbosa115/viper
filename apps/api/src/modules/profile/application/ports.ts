import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Product } from '../domain/product.js';
import type { BusinessProfile } from '../domain/profile.js';

export interface ProfileRepository {
  find(businessId: string): Promise<BusinessProfile | null>;
  /** Insert or update (one row per Business). */
  save(profile: BusinessProfile): Promise<void>;
}

export interface ProductRepository {
  /** Every Product of a Business, oldest first (a Business has a handful). */
  list(businessId: string): Promise<Product[]>;
  find(businessId: string, id: string): Promise<Product | null>;
  save(businessId: string, product: Product): Promise<void>;
  remove(businessId: string, id: string): Promise<void>;
}

export interface ProfileRepos {
  profiles: ProfileRepository;
  products: ProductRepository;
}

export type ProfileUnitOfWork = UnitOfWork<ProfileRepos>;

/** identity's Business name (the profile shows it; FR-15 renames it through identity). */
export interface BusinessNames {
  getName(businessId: string): Promise<string | null>;
  rename(businessId: string, name: string): Promise<void>;
}

/**
 * "Is this Product pitched by a Plan segment?" (FR-15 PRODUCT_IN_USE). planning satisfies it;
 * until then nothing is in use.
 */
export interface ProductUsage {
  isInUse(businessId: string, productId: string): Promise<boolean>;
}

export const noProductUsage: ProductUsage = { isInUse: () => Promise.resolve(false) };
