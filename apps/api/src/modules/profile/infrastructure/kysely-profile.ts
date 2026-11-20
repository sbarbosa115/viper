import type { Insertable, Kysely, Transaction } from 'kysely';
import type { Database } from '../../../shared/infrastructure/db/database.js';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import { KyselyUnitOfWork } from '../../../shared/infrastructure/db/unit-of-work.js';
import { Product } from '../domain/product.js';
import { BusinessProfile } from '../domain/profile.js';
import type {
  ProductRepository,
  ProfileRepos,
  ProfileRepository,
  ProfileUnitOfWork,
} from '../application/ports.js';
import type { BusinessProfilesTable } from './tables.js';

type Db = Kysely<DB> | Transaction<DB>;

function toRow(
  profile: BusinessProfile,
): Insertable<BusinessProfilesTable> & { business_id: string } {
  const s = profile.toSnapshot();
  return {
    business_id: s.businessId,
    description: s.description,
    category: s.category,
    address_line1: s.address.line1,
    city: s.address.city,
    state: s.address.state,
    postal_code: s.address.postalCode,
    lat: s.location?.lat ?? null,
    lng: s.location?.lng ?? null,
    location_label: s.location?.label ?? null,
    delivery_radius_miles: s.deliveryRadiusMiles,
    current_customers: s.currentCustomers,
    price_range: s.priceRange,
    website: s.website,
    completed_at: s.completedAt,
    updated_at: s.updatedAt,
  };
}

export class KyselyProfileRepository implements ProfileRepository {
  constructor(private readonly db: Db) {}

  async find(businessId: string): Promise<BusinessProfile | null> {
    const r = await this.db
      .selectFrom('business_profiles')
      .selectAll()
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (!r) return null;
    return BusinessProfile.restore({
      businessId: r.business_id,
      description: r.description,
      category: r.category,
      address: {
        line1: r.address_line1,
        city: r.city,
        state: r.state,
        postalCode: r.postal_code,
      },
      location:
        r.lat !== null && r.lng !== null
          ? { lat: Number(r.lat), lng: Number(r.lng), label: r.location_label ?? '' }
          : null,
      deliveryRadiusMiles:
        r.delivery_radius_miles === null ? null : Number(r.delivery_radius_miles),
      currentCustomers: r.current_customers,
      priceRange: r.price_range,
      website: r.website,
      completedAt: r.completed_at,
      updatedAt: r.updated_at,
    });
  }

  async save(profile: BusinessProfile): Promise<void> {
    const { business_id: _id, ...update } = toRow(profile);
    await this.db
      .insertInto('business_profiles')
      .values(toRow(profile))
      .onDuplicateKeyUpdate(update)
      .execute();
  }
}

export class KyselyProductRepository implements ProductRepository {
  constructor(private readonly db: Db) {}

  async list(businessId: string): Promise<Product[]> {
    const rows = await this.db
      .selectFrom('products')
      .selectAll()
      .where('business_id', '=', businessId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map((r) =>
      Product.restore({
        id: r.id,
        businessId: r.business_id,
        name: r.name,
        description: r.description,
        createdAt: r.created_at,
      }),
    );
  }

  async find(businessId: string, id: string): Promise<Product | null> {
    const r = await this.db
      .selectFrom('products')
      .selectAll()
      .where('id', '=', id)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    return r
      ? Product.restore({
          id: r.id,
          businessId: r.business_id,
          name: r.name,
          description: r.description,
          createdAt: r.created_at,
        })
      : null;
  }

  async save(businessId: string, product: Product): Promise<void> {
    const s = product.toSnapshot();
    if (s.businessId !== businessId) throw new Error('Product belongs to another Business');
    await this.db
      .insertInto('products')
      .values({
        id: s.id,
        business_id: s.businessId,
        name: s.name,
        description: s.description,
        created_at: s.createdAt,
      })
      .onDuplicateKeyUpdate({ name: s.name, description: s.description })
      .execute();
  }

  async remove(businessId: string, id: string): Promise<void> {
    await this.db
      .deleteFrom('products')
      .where('id', '=', id)
      .where('business_id', '=', businessId)
      .execute();
  }
}

export function kyselyProfileUnitOfWork(db: Database): ProfileUnitOfWork {
  return new KyselyUnitOfWork<ProfileRepos>(db, (trx) => ({
    profiles: new KyselyProfileRepository(trx),
    products: new KyselyProductRepository(trx),
  }));
}
