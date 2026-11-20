import { describe, expect, test } from 'vitest';
import {
  goalSuggestions,
  nextTopic,
  shapeReply,
  startOfUtcDay,
  type Topic,
} from './welcome-flow.js';

const none = new Set<Topic>();
const progress = {
  productsCount: 0,
  hasLocation: false,
  hasRadius: false,
  hasCurrentCustomers: false,
  complete: false,
};

describe('FR-14: question order', () => {
  test('products → location → radius → who buys today → goal', () => {
    expect(nextTopic(progress, none)).toBe('products');
    expect(nextTopic({ ...progress, productsCount: 1 }, none)).toBe('location');
    expect(nextTopic({ ...progress, productsCount: 1, hasLocation: true }, none)).toBe('radius');
    const complete = {
      ...progress,
      productsCount: 1,
      hasLocation: true,
      hasRadius: true,
      complete: true,
    };
    expect(nextTopic(complete, none)).toBe('currentCustomers');
    expect(nextTopic({ ...complete, hasCurrentCustomers: true }, none)).toBe('goal');
  });

  test('skips what is already answered, in any order', () => {
    expect(nextTopic({ ...progress, hasLocation: true, hasRadius: true }, none)).toBe('products');
  });

  test('"who buys today" is asked once and may be skipped', () => {
    const complete = {
      ...progress,
      productsCount: 2,
      hasLocation: true,
      hasRadius: true,
      complete: true,
    };
    expect(nextTopic(complete, new Set<Topic>(['currentCustomers']))).toBe('goal');
  });
});

describe('FR-14: reply shape', () => {
  test('text ≤ 600 chars, 0–4 distinct quick replies', () => {
    const r = shapeReply(`  ${'a'.repeat(700)} `, [
      'One',
      'one',
      ' ',
      'Two',
      'Three',
      'Four',
      'Five',
    ]);
    expect(r.text).toHaveLength(600);
    expect(r.quickReplies).toEqual(['One', 'Two', 'Three', 'Four']);
  });
});

describe('FR-14: goal quick replies drafted from the Products', () => {
  test('e.g. "Bakeries within 3 miles that could buy our cane sugar"', () => {
    expect(goalSuggestions(['Cane sugar, 50 lb bag', 'Powdered sugar, 25 lb bag'], 3)).toEqual([
      'Bakeries within 3 miles that could buy our cane sugar',
      'Restaurants within 3 miles that could buy our powdered sugar',
      'Coffee shops within 3 miles that could buy our cane sugar',
    ]);
    expect(goalSuggestions(['Espresso beans'], 1)[0]).toBe(
      'Bakeries within 1 mile that could buy our espresso beans',
    );
    expect(goalSuggestions([], 3)).toEqual([]);
  });
});

test('startOfUtcDay', () => {
  expect(startOfUtcDay(new Date('2026-11-19T23:59:59.999Z'))).toEqual(
    new Date('2026-11-19T00:00:00.000Z'),
  );
});
