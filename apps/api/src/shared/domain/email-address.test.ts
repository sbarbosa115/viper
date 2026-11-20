import { describe, expect, test } from 'vitest';
import { EmailAddress } from './email-address.js';
import { ValidationError } from './errors.js';

describe('shared kernel: EmailAddress', () => {
  test('normalises case and whitespace', () => {
    expect(EmailAddress.create('  Ana@Example.COM ').value).toBe('ana@example.com');
  });

  test('rejects an invalid address', () => {
    expect(() => EmailAddress.create('not-an-email')).toThrow(ValidationError);
  });

  test('compares by value', () => {
    expect(EmailAddress.create('a@b.co').equals(EmailAddress.create('A@B.co'))).toBe(true);
  });
});
