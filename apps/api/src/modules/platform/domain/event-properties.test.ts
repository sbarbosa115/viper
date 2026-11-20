import { describe, expect, test } from 'vitest';
import { safeEventProperties } from './event-properties.js';

describe('FR-9 / NFR-5: no personal data in event properties', () => {
  test('keeps ids, counts, flags and enum values', () => {
    const props = {
      run_id: '00000000-0000-7000-8000-000000000001',
      step_key: 'find_places',
      credits_spent: 137,
      budget_reached: false,
      status: 'completed',
      fit_score: null,
    };
    expect(safeEventProperties(props)).toEqual(props);
  });

  test('drops personal keys, email- and phone-like values and nested objects', () => {
    expect(
      safeEventProperties({
        email: 'owner@demo.test',
        member_name: 'Ana',
        phone: '123',
        contact: 'someone@example.com',
        callback: '+1 512 555 0100',
        local: '512-555-0100',
        api_key: 'sk-123',
        nested: { a: 1 },
        list: [1, 2],
        source: 'landing',
      }),
    ).toEqual({ source: 'landing' });
  });

  test('no properties is an empty object', () => {
    expect(safeEventProperties(undefined)).toEqual({});
  });
});
