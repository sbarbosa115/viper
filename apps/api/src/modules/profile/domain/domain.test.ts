import { describe, expect, test } from 'vitest';
import { Product } from './product.js';
import { addressQuery, BusinessProfile, isProfileComplete, sameAddress } from './profile.js';

const now = new Date('2026-11-19T10:00:00.000Z');
const austin = { lat: 30.2624, lng: -97.7262, label: '1200 E 6th St, Austin, TX 78702' };

describe('FR-14: profile completeness', () => {
  test('complete needs ≥ 1 Product, a geocoded location and a delivery radius', () => {
    expect(isProfileComplete({ location: austin, deliveryRadiusMiles: 3 }, 1)).toBe(true);
    expect(isProfileComplete({ location: austin, deliveryRadiusMiles: 3 }, 0)).toBe(false);
    expect(isProfileComplete({ location: null, deliveryRadiusMiles: 3 }, 1)).toBe(false);
    expect(isProfileComplete({ location: austin, deliveryRadiusMiles: null }, 1)).toBe(false);
    expect(isProfileComplete({ location: austin, deliveryRadiusMiles: 0 }, 1)).toBe(true);
  });

  test('markCompletedIfFirst is true only the first time it completes', () => {
    const p = BusinessProfile.empty('b1', now);
    expect(p.markCompletedIfFirst(1, now)).toBe(false);
    p.change({ location: austin, deliveryRadiusMiles: 3 }, now);
    expect(p.markCompletedIfFirst(0, now)).toBe(false);
    expect(p.markCompletedIfFirst(1, now)).toBe(true);
    expect(p.completedAt).toEqual(now);
    expect(p.markCompletedIfFirst(1, now)).toBe(false);
  });
});

describe('FR-15: profile fields', () => {
  test('a partial change keeps the other fields and trims text', () => {
    const p = BusinessProfile.empty('b1', now);
    p.change({ description: '  Sugar wholesaler ', address: { city: 'Austin' } }, now);
    p.change({ address: { state: 'TX' }, website: null }, now);
    expect(p.fields.description).toBe('Sugar wholesaler');
    expect(p.fields.address).toEqual({
      line1: null,
      city: 'Austin',
      state: 'TX',
      postalCode: null,
    });
  });

  test('empty text clears a field', () => {
    const p = BusinessProfile.empty('b1', now);
    p.change({ category: 'Wholesale' }, now);
    p.change({ category: '  ' }, now);
    expect(p.fields.category).toBeNull();
  });

  test.each([-1, 101, Number.NaN])('rejects a delivery radius of %s', (radius) => {
    const p = BusinessProfile.empty('b1', now);
    expect(() => p.change({ deliveryRadiusMiles: radius }, now)).toThrowError(/0 to 100/);
  });

  test('rejects text over the limits', () => {
    const p = BusinessProfile.empty('b1', now);
    expect(() => p.change({ currentCustomers: 'x'.repeat(501) }, now)).toThrowError(/too long/);
    expect(() => p.change({ priceRange: 'x'.repeat(121) }, now)).toThrowError(/too long/);
  });

  test('addressQuery joins the parts; sameAddress ignores case and spaces', () => {
    expect(
      addressQuery({ line1: '1200 E 6th St', city: 'Austin', state: 'TX', postalCode: '78702' }),
    ).toBe('1200 E 6th St, Austin, TX 78702');
    expect(addressQuery({ line1: null, city: ' ', state: null, postalCode: null })).toBeNull();
    expect(
      sameAddress(
        { line1: 'A St', city: 'Austin', state: null, postalCode: null },
        { line1: ' a st', city: 'AUSTIN', state: '', postalCode: null },
      ),
    ).toBe(true);
  });
});

describe('FR-15: products', () => {
  test('name 1–120, description ≤ 500', () => {
    expect(() => Product.create({ id: 'p', businessId: 'b', name: ' ', now })).toThrowError();
    expect(() =>
      Product.create({ id: 'p', businessId: 'b', name: 'x'.repeat(121), now }),
    ).toThrowError();
    expect(() =>
      Product.create({
        id: 'p',
        businessId: 'b',
        name: 'Sugar',
        description: 'x'.repeat(501),
        now,
      }),
    ).toThrowError();
    const p = Product.create({ id: 'p', businessId: 'b', name: ' Powdered sugar, 25 lb ', now });
    expect(p.toSnapshot()).toMatchObject({ name: 'Powdered sugar, 25 lb', description: '' });
    expect(p.hasName('powdered  SUGAR, 25 lb')).toBe(true);
  });
});
