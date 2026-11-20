import { describe, expect, test } from 'vitest';
import { uuidv7 } from './uuid7.js';

describe('shared kernel: uuidv7', () => {
  test('has version 7 and the RFC variant', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test('sorts by creation time', () => {
    expect(uuidv7(1_000_000_000_000) < uuidv7(1_000_000_000_001)).toBe(true);
  });
});
