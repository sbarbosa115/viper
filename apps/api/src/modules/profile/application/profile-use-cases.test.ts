import { describe, expect, test } from 'vitest';
import {
  actingAs,
  austinInput,
  BUSINESS,
  OTHER_BUSINESS,
  owner,
  OWNER_ID,
  profileFixture,
} from '../test/profile-fixture.js';

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: unknown) => (e as { code?: string }).code ?? String(e),
  );

describe('FR-15: read the Business Profile', () => {
  test('an untouched profile is empty and not complete', async () => {
    const { service } = profileFixture();
    expect(await service.view(owner())).toEqual({
      businessName: 'Sweet Supply Co',
      description: null,
      category: null,
      address: { line1: null, city: null, state: null, postalCode: null, country: 'US' },
      location: null,
      deliveryRadiusMiles: null,
      currentCustomers: null,
      priceRange: null,
      website: null,
      products: [],
      complete: false,
    });
  });

  test('a Member without the owner role is refused', async () => {
    const { service } = profileFixture();
    expect(await codeOf(service.view(owner({ roles: [] })))).toBe('FORBIDDEN');
  });
});

describe('FR-15: edit the Business Profile by hand', () => {
  test('saving geocodes the changed address and renames the Business through identity', async () => {
    const { service, names } = profileFixture();
    const saved = await service.update(owner(), { ...austinInput, businessName: 'Sweet Supply' });
    expect(saved.location).toEqual({
      lat: 30.2624,
      lng: -97.7262,
      label: '1200 E 6th St, Austin, TX 78702',
    });
    expect(saved.businessName).toBe('Sweet Supply');
    expect(names.names.get(BUSINESS)).toBe('Sweet Supply');
    expect(saved.deliveryRadiusMiles).toBe(3);
  });

  test('an address that cannot be found → ADDRESS_NOT_FOUND, nothing saved', async () => {
    const { service } = profileFixture();
    const input = {
      ...austinInput,
      address: { ...austinInput.address, line1: '1 Nowhere Rd', city: 'Atlantis' },
    };
    expect(await codeOf(service.update(owner(), input))).toBe('ADDRESS_NOT_FOUND');
    expect((await service.view(owner())).address.line1).toBeNull();
  });

  test('an unchanged address is not geocoded again', async () => {
    const f = profileFixture();
    await f.service.update(owner(), austinInput);
    let calls = 0;
    const counting = { search: () => ((calls += 1), Promise.resolve([])) };
    const again = (await import('../index.js')).createInMemoryProfile({
      clock: f.clock,
      ids: { next: () => 'x' },
      geocoder: counting,
    });
    again.store.profiles = f.store.profiles;
    await again.service.update(owner(), { ...austinInput, description: 'New' });
    expect(calls).toBe(0);
  });

  test('clearing the address clears the location', async () => {
    const { service } = profileFixture();
    await service.update(owner(), austinInput);
    const cleared = await service.update(owner(), {
      ...austinInput,
      address: { line1: null, city: null, state: null, postalCode: null, country: 'US' },
    });
    expect(cleared.location).toBeNull();
  });

  test('profile_completed fires once with via manual when it first completes', async () => {
    const { service, analytics } = profileFixture();
    await service.update(owner(), austinInput);
    expect(analytics.events).toHaveLength(0);
    await service.createProduct(owner(), { name: 'Cane sugar, 50 lb bag' });
    await service.createProduct(owner(), { name: 'Powdered sugar, 25 lb' });
    await service.update(owner(), { ...austinInput, description: 'Changed' });
    expect(analytics.events).toEqual([
      {
        name: 'profile_completed',
        actor: { memberId: OWNER_ID, businessId: BUSINESS },
        properties: { business_id: BUSINESS, via: 'manual', messages_count: 0 },
      },
    ]);
    expect((await service.view(owner())).complete).toBe(true);
  });

  test('Staff Acting as edits the target Business', async () => {
    const { service } = profileFixture();
    await service.update(actingAs(), austinInput);
    expect((await service.getProfile(BUSINESS)).address.city).toBe('Austin');
  });
});

describe('FR-15: Products', () => {
  test('AC: adding "Powdered sugar, 25 lb" shows it in the profile and in Plan product pickers', async () => {
    const { service, profileQueries } = profileFixture();
    const product = await service.createProduct(owner(), { name: 'Powdered sugar, 25 lb' });
    expect(product).toEqual({
      id: expect.any(String),
      name: 'Powdered sugar, 25 lb',
      description: '',
    });
    expect((await service.view(owner())).products).toEqual([product]);
    expect(await profileQueries.listProducts(BUSINESS)).toEqual([product]);
  });

  test('edit and delete a Product', async () => {
    const { service } = profileFixture();
    const product = await service.createProduct(owner(), { name: 'Cane sugar' });
    const edited = await service.updateProduct(owner(), product.id, {
      name: 'Cane sugar, 50 lb bag',
      description: 'Bulk',
    });
    expect(edited).toEqual({ id: product.id, name: 'Cane sugar, 50 lb bag', description: 'Bulk' });
    await service.deleteProduct(owner(), product.id);
    expect((await service.view(owner())).products).toEqual([]);
  });

  test('a Product pitched by a Plan segment cannot be deleted (PRODUCT_IN_USE)', async () => {
    const { service, usage } = profileFixture();
    const product = await service.createProduct(owner(), { name: 'Cane sugar' });
    usage.inUse.add(product.id);
    expect(await codeOf(service.deleteProduct(owner(), product.id))).toBe('PRODUCT_IN_USE');
    expect((await service.view(owner())).products).toHaveLength(1);
  });

  test('cross-Business: another Business cannot see, edit or delete the Product', async () => {
    const { service } = profileFixture();
    const product = await service.createProduct(owner(), { name: 'Cane sugar' });
    const other = owner({ businessId: OTHER_BUSINESS });
    expect((await service.view(other)).products).toEqual([]);
    expect(
      await codeOf(service.updateProduct(other, product.id, { name: 'Hijack', description: '' })),
    ).toBe('NOT_FOUND');
    expect(await codeOf(service.deleteProduct(other, product.id))).toBe('NOT_FOUND');
    expect((await service.view(owner())).products).toHaveLength(1);
  });

  test('unknown Product → NOT_FOUND', async () => {
    const { service } = profileFixture();
    expect(
      await codeOf(service.deleteProduct(owner(), '00000000-0000-7000-8000-0000000000ff')),
    ).toBe('NOT_FOUND');
  });
});

describe('FR-14: applyUpdates (the assistant)', () => {
  test('applies partial updates and new Products, skipping names it already has', async () => {
    const { profileCommands, profileQueries } = profileFixture();
    await profileCommands.applyUpdates(BUSINESS, {
      addProducts: [{ name: 'Cane sugar, 50 lb bag' }, { name: 'Powdered sugar, 25 lb bag' }],
    });
    const { profile } = await profileCommands.applyUpdates(BUSINESS, {
      addProducts: [{ name: 'cane sugar, 50 lb bag' }],
      address: { city: 'Austin', state: 'TX' },
    });
    expect(profile.products.map((p) => p.name)).toEqual([
      'Cane sugar, 50 lb bag',
      'Powdered sugar, 25 lb bag',
    ]);
    expect(profile.address).toMatchObject({ city: 'Austin', state: 'TX', line1: null });
    expect(await profileQueries.isComplete(BUSINESS)).toBe(false);
  });

  test('profile_completed fires exactly once per Business with via chat and messages_count', async () => {
    const { profileCommands, analytics } = profileFixture();
    const location = { lat: 30.2672, lng: -97.7431, label: 'Austin, TX' };
    await profileCommands.applyUpdates(BUSINESS, { addProducts: [{ name: 'Sugar' }] });
    const done = await profileCommands.applyUpdates(
      BUSINESS,
      { location, deliveryRadiusMiles: 3 },
      { via: 'chat', messagesCount: 3, memberId: OWNER_ID },
    );
    expect(done.completedNow).toBe(true);
    const again = await profileCommands.applyUpdates(
      BUSINESS,
      { deliveryRadiusMiles: 5 },
      { via: 'chat', messagesCount: 4 },
    );
    expect(again.completedNow).toBe(false);
    expect(analytics.events.map((e) => e.properties)).toEqual([
      { business_id: BUSINESS, via: 'chat', messages_count: 3 },
    ]);
  });

  test('an invalid update changes nothing', async () => {
    const { profileCommands, profileQueries } = profileFixture();
    await expect(
      profileCommands.applyUpdates(BUSINESS, {
        addProducts: [{ name: 'Sugar' }],
        deliveryRadiusMiles: 500,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await profileQueries.listProducts(BUSINESS)).toEqual([]);
  });
});
