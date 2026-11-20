import { describe, expect, test } from 'vitest';
import { t } from './index';

describe('i18n: t()', () => {
  test('returns the string for a key', () => {
    expect(t('product.name')).toBe('Llyner Leads');
  });
  test('fills placeholders and leaves unknown ones', () => {
    expect(t('account.stopActing', { business: 'Acme' })).toBe('Stop acting as Acme');
    expect(t('placeholder.coming', {})).toBe('Coming in wave {wave}');
  });
});
