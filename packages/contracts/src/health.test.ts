import { describe, expect, test } from 'vitest';
import { errorResponse, healthResponse } from './index.js';

describe('contracts: shared shapes', () => {
  test('health parses a healthy response', () => {
    expect(
      healthResponse.parse({ status: 'ok', checks: { database: 'ok', cache: 'ok' } }).status,
    ).toBe('ok');
  });

  test('error response allows optional field messages', () => {
    const parsed = errorResponse.parse({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid', fields: { email: 'Required' } },
    });
    expect(parsed.error.fields?.email).toBe('Required');
  });
});
