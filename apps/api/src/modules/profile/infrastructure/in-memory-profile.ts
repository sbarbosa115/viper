import { Product, type ProductSnapshot } from '../domain/product.js';
import { BusinessProfile, type ProfileSnapshot } from '../domain/profile.js';
import type {
  BusinessNames,
  ProductRepository,
  ProductUsage,
  ProfileRepos,
  ProfileRepository,
  ProfileUnitOfWork,
} from '../application/ports.js';

/**
 * In-memory profile storage (tests and other modules' tests). Stores cloned snapshots, so a
 * change without save() is lost, like with the database. A failed unit of work rolls back.
 */
export class InMemoryProfileStore implements ProfileUnitOfWork {
  profiles = new Map<string, ProfileSnapshot>();
  products = new Map<string, ProductSnapshot>();

  run<T>(fn: (repos: ProfileRepos) => Promise<T>): Promise<T> {
    const before = { profiles: new Map(this.profiles), products: new Map(this.products) };
    return fn({ profiles: this.profileRepository(), products: this.productRepository() }).catch(
      (error: unknown) => {
        this.profiles = before.profiles;
        this.products = before.products;
        throw error;
      },
    );
  }

  private profileRepository(): ProfileRepository {
    return {
      find: (businessId) => {
        const s = this.profiles.get(businessId);
        return Promise.resolve(s ? BusinessProfile.restore(structuredClone(s)) : null);
      },
      save: (profile) => {
        this.profiles.set(profile.businessId, structuredClone(profile.toSnapshot()));
        return Promise.resolve();
      },
    };
  }

  private productRepository(): ProductRepository {
    return {
      list: (businessId) =>
        Promise.resolve(
          [...this.products.values()]
            .filter((p) => p.businessId === businessId)
            .sort(
              (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
            )
            .map((p) => Product.restore(structuredClone(p))),
        ),
      find: (businessId, id) => {
        const s = this.products.get(id);
        return Promise.resolve(
          s?.businessId === businessId ? Product.restore(structuredClone(s)) : null,
        );
      },
      save: (businessId, product) => {
        const s = product.toSnapshot();
        if (s.businessId !== businessId) throw new Error('Product belongs to another Business');
        this.products.set(s.id, structuredClone(s));
        return Promise.resolve();
      },
      remove: (businessId, id) => {
        if (this.products.get(id)?.businessId === businessId) this.products.delete(id);
        return Promise.resolve();
      },
    };
  }
}

/** Business names kept in memory (identity's role in tests). */
export class InMemoryBusinessNames implements BusinessNames {
  readonly names = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [id, name] of Object.entries(initial)) this.names.set(id, name);
  }
  getName(businessId: string): Promise<string | null> {
    return Promise.resolve(this.names.get(businessId) ?? null);
  }
  rename(businessId: string, name: string): Promise<void> {
    this.names.set(businessId, name.trim());
    return Promise.resolve();
  }
}

/** Products marked as pitched by a Plan segment (planning's role in tests). */
export class FakeProductUsage implements ProductUsage {
  readonly inUse = new Set<string>();
  isInUse(_businessId: string, productId: string): Promise<boolean> {
    return Promise.resolve(this.inUse.has(productId));
  }
}
