import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { FixtureGeocoder } from '../../../shared/infrastructure/geo/fixture-geocoder.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createProfile, FakeProductUsage, InMemoryBusinessNames, seed } from '../index.js';
import { austinInput, BUSINESS, OTHER_BUSINESS, owner } from '../test/profile-fixture.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));

function build() {
  const analytics = new RecordingAnalyticsTracker();
  const names = new InMemoryBusinessNames({ [BUSINESS]: 'Sweet Supply Co' });
  const usage = new FakeProductUsage();
  const profile = createProfile({
    db,
    clock,
    ids: new Uuid7Generator(),
    analytics,
    geocoder: new FixtureGeocoder(),
    businesses: names,
    productUsage: usage,
  });
  return { ...profile, analytics, names, usage };
}

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const table of ['business_profiles', 'products']) {
    await sql.raw(`TRUNCATE TABLE ${table}`).execute(db);
  }
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
});

afterAll(async () => {
  await db.destroy();
});

describe('profile on MySQL', () => {
  test('round trip: fields, decimals, location, products and completion', async () => {
    const p = build();
    await p.service.update(owner(), { ...austinInput, deliveryRadiusMiles: 2.5 });
    await p.service.createProduct(owner(), { name: 'Cane sugar, 50 lb bag', description: 'Bulk' });
    const read = await build().profileQueries.getProfile(BUSINESS);
    expect(read).toMatchObject({
      businessName: 'Sweet Supply Co',
      address: {
        line1: '1200 E 6th St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78702',
        country: 'US',
      },
      location: { lat: 30.2624, lng: -97.7262, label: '1200 E 6th St, Austin, TX 78702' },
      deliveryRadiusMiles: 2.5,
      currentCustomers: 'Restaurants',
      products: [{ name: 'Cane sugar, 50 lb bag', description: 'Bulk' }],
      complete: true,
    });
    const row = await db
      .selectFrom('business_profiles')
      .select(['completed_at', 'country'])
      .where('business_id', '=', BUSINESS)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ completed_at: clock.now(), country: 'US' });
    expect(p.analytics.events.map((e) => e.name)).toEqual(['profile_completed']);
  });

  test('every query is scoped to the Business', async () => {
    const p = build();
    const product = await p.service.createProduct(owner(), { name: 'Cane sugar' });
    const other = owner({ businessId: OTHER_BUSINESS });
    expect(await p.profileQueries.listProducts(OTHER_BUSINESS)).toEqual([]);
    await expect(p.service.deleteProduct(other, product.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      p.service.updateProduct(other, product.id, { name: 'x', description: '' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await p.profileQueries.listProducts(BUSINESS)).toHaveLength(1);
  });

  test('a failed update rolls back new Products', async () => {
    const p = build();
    await expect(
      p.profileCommands.applyUpdates(BUSINESS, {
        addProducts: [{ name: 'Sugar' }],
        deliveryRadiusMiles: 1000,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await p.profileQueries.listProducts(BUSINESS)).toEqual([]);
  });

  test('seed (section 8a) is idempotent', async () => {
    const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
    const demo = {
      businesses: { sweetSupply: id(0xd001), cleanDesk: id(0xd002), cornerCoffee: id(0xd003) },
      products: { caneSugar: id(0xd201), powderedSugar: id(0xd202), espressoBeans: id(0xd203) },
    };
    await seed({ db, clock, demo });
    await seed({ db, clock, demo });
    const q = build().profileQueries;
    const sweet = await q.getProfile(demo.businesses.sweetSupply);
    expect(sweet).toMatchObject({
      address: { line1: '1200 E 6th St', city: 'Austin', state: 'TX' },
      deliveryRadiusMiles: 3,
      currentCustomers: 'Restaurants',
      complete: true,
    });
    expect(sweet.products.map((p) => p.name)).toEqual([
      'Cane sugar, 50 lb bag',
      'Powdered sugar, 25 lb bag',
      'Brown sugar, 50 lb bag',
    ]);
    expect(sweet.products[0]?.id).toBe(demo.products.caneSugar);
    expect((await q.getProfile(demo.businesses.cornerCoffee)).complete).toBe(true);
    expect((await q.getProfile(demo.businesses.cleanDesk)).complete).toBe(false);
  });
});
