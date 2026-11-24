import { describe, expect, test } from 'vitest';
import { bill, NOW, oneOff, STAFF_ID, TODAY } from '../test/factories.js';
import {
  addDays,
  addMonths,
  clampedDay,
  monthRange,
  pctOneDecimal,
  roundHalfUp,
} from './calendar.js';
import { Expense, type NewRecurring } from './expense.js';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return { code: (e as { code: string }).code, details: (e as { details?: unknown }).details };
  }
  throw new Error('expected an error');
};

const recurring = (over: Partial<NewRecurring> = {}): NewRecurring => ({
  id: 'e1',
  priceId: 'p1',
  name: 'DigitalOcean App Platform',
  vendor: 'DigitalOcean',
  category: 'hosting',
  amountCents: 4215,
  cadence: 'monthly',
  startsOn: '2026-11-05',
  endsOn: null,
  coversProvider: null,
  link: null,
  notes: null,
  createdByMemberId: STAFF_ID,
  ...over,
});

describe('calendar and rounding', () => {
  test('half up in integers, away from zero for negatives', () => {
    expect(roundHalfUp(1499, 12)).toBe(125);
    expect(roundHalfUp(5, 10)).toBe(1);
    expect(roundHalfUp(4, 10)).toBe(0);
    expect(roundHalfUp(-5, 10)).toBe(-1);
    expect(roundHalfUp(-4, 10)).toBe(0);
    expect(pctOneDecimal(445, 1275)).toBe(34.9);
    expect(pctOneDecimal(-32575, 19700)).toBe(-165.4);
  });

  test('months and days', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-11', -11)).toBe('2025-12');
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(addDays('2026-11-20', 366)).toBe('2027-11-21');
    expect(clampedDay('2027-02', 31)).toBe('2027-02-28');
    expect(clampedDay('2028-02', 31)).toBe('2028-02-29');
    expect(clampedDay('2026-04', 31)).toBe('2026-04-30');
  });
});

describe('FR-2: Charges are derived', () => {
  test('a monthly bill charges on its start day each month, up to today', () => {
    const b = bill('DigitalOcean App Platform', 'hosting', 4215, '2026-11-05');
    expect(b.chargesIn('2026-11', TODAY)).toEqual([{ date: '2026-11-05', amountCents: 4215 }]);
    expect(b.chargesIn('2026-12', TODAY)).toEqual([]);
    expect(b.chargesIn('2026-12', '2026-12-05')).toEqual([
      { date: '2026-12-05', amountCents: 4215 },
    ]);
    expect(b.nextChargeOn(TODAY)).toBe('2026-12-05');
  });

  test('a Charge dated today counts; one later this month does not', () => {
    expect(bill('A', 'hosting', 100, '2026-11-20').chargesIn('2026-11', TODAY)).toHaveLength(1);
    const later = bill('B', 'hosting', 100, '2026-11-25');
    expect(later.chargesIn('2026-11', TODAY)).toEqual([]);
    expect(later.nextChargeOn(TODAY)).toBe('2026-11-25');
    expect(later.hasChargedBy(TODAY)).toBe(false);
  });

  test('the 31st clamps to the last day: Feb 28, Feb 29 in a leap year, Apr 30', () => {
    const b = bill('A', 'hosting', 100, '2026-12-31');
    const today = '2028-12-31';
    expect(b.chargesIn('2027-02', today)).toEqual([{ date: '2027-02-28', amountCents: 100 }]);
    expect(b.chargesIn('2028-02', today)).toEqual([{ date: '2028-02-29', amountCents: 100 }]);
    expect(b.chargesIn('2027-04', today)).toEqual([{ date: '2027-04-30', amountCents: 100 }]);
    expect(b.chargesIn('2027-03', today)).toEqual([{ date: '2027-03-31', amountCents: 100 }]);
    expect(b.nextChargeOn('2027-01-31')).toBe('2027-02-28');
  });

  test('a yearly bill charges on its anniversary only; Feb 29 falls on Feb 28', () => {
    const domain = bill('llyner.com', 'domain_dns', 1499, '2026-11-02', { cadence: 'yearly' });
    const today = '2028-12-01';
    expect(domain.chargesIn('2026-11', today)).toEqual([{ date: '2026-11-02', amountCents: 1499 }]);
    expect(domain.chargesIn('2026-12', today)).toEqual([]);
    expect(domain.chargesIn('2027-11', today)).toEqual([{ date: '2027-11-02', amountCents: 1499 }]);
    expect(domain.nextChargeOn(TODAY)).toBe('2027-11-02');
    expect(domain.monthlyEquivalent(1499)).toBe(125);

    const leap = bill('Leap', 'other', 1200, '2028-02-29', { cadence: 'yearly' });
    expect(leap.chargesIn('2029-02', '2030-01-01')).toEqual([
      { date: '2029-02-28', amountCents: 1200 },
    ]);
    expect(leap.chargesIn('2032-02', '2033-01-01')).toEqual([
      { date: '2032-02-29', amountCents: 1200 },
    ]);
  });

  test('FR-1, FR-3: no Charge after endsOn; status active, ending, ended', () => {
    const b = bill('A', 'hosting', 100, '2026-11-05', { endsOn: '2026-11-30' });
    expect(b.status(TODAY)).toBe('ending');
    expect(b.status('2026-12-10')).toBe('ended');
    expect(b.chargesIn('2026-12', '2026-12-10')).toEqual([]);
    expect(b.nextChargeOn(TODAY)).toBeNull();
    const ends = bill('B', 'hosting', 100, '2026-11-05', { endsOn: '2026-12-31' });
    expect(ends.chargesIn('2027-01', '2027-01-20')).toEqual([]);
    expect(ends.chargesIn('2026-12', '2027-01-20')).toHaveLength(1);
    expect(bill('C', 'hosting', 100, '2026-11-05').status(TODAY)).toBe('active');
  });

  test('a One-off counts once, in the month of spentOn', () => {
    const o = oneOff('Terms and privacy review', 'legal_admin', 30000, '2026-11-12');
    expect(o.chargesIn('2026-11', TODAY)).toEqual([{ date: '2026-11-12', amountCents: 30000 }]);
    expect(o.chargesIn('2026-12', '2026-12-10')).toEqual([]);
    expect(o.nextChargeOn(TODAY)).toBeNull();
    expect(o.monthlyEquivalent(30000)).toBeNull();
  });
});

describe('FR-2: creating a Recurring bill', () => {
  test('before the history start is 422 BEFORE_HISTORY_START', () => {
    expect(
      code(() => Expense.createRecurring(recurring({ startsOn: '2026-10-31' }), NOW, TODAY)).code,
    ).toBe('BEFORE_HISTORY_START');
  });

  test('more than 366 days ahead, or ending before it starts, is 400', () => {
    expect(
      Expense.createRecurring(recurring({ startsOn: '2027-11-21' }), NOW, TODAY).startsOn,
    ).toBe('2027-11-21');
    const ahead = code(() =>
      Expense.createRecurring(recurring({ startsOn: '2027-11-22' }), NOW, TODAY),
    );
    expect(ahead.code).toBe('VALIDATION_ERROR');
    expect(ahead.details).toHaveProperty('startsOn');
    const ends = code(() =>
      Expense.createRecurring(recurring({ endsOn: '2026-11-04' }), NOW, TODAY),
    );
    expect(ends.details).toHaveProperty('endsOn');
  });

  test('covering a provider needs category AI or Data providers (422)', () => {
    expect(
      code(() => Expense.createRecurring(recurring({ coversProvider: 'Apify' }), NOW, TODAY)).code,
    ).toBe('COVERS_PROVIDER_CATEGORY');
    const plan = Expense.createRecurring(
      recurring({ category: 'data_providers', coversProvider: 'Apify' }),
      NOW,
      TODAY,
    );
    expect(plan.coversProvider).toBe('Apify');
  });

  test('coverage periods overlap unless one ends before the other starts', () => {
    const a = bill('A', 'data_providers', 100, '2026-11-03', { endsOn: '2026-11-30' });
    expect(a.overlaps({ startsOn: '2026-12-01', endsOn: null })).toBe(false);
    expect(a.overlaps({ startsOn: '2026-11-30', endsOn: null })).toBe(true);
    expect(
      bill('B', 'ai', 1, '2026-12-01').overlaps({ startsOn: '2026-11-01', endsOn: null }),
    ).toBe(true);
  });
});

describe('FR-4: One-off dates', () => {
  const base = {
    id: 'o1',
    priceId: 'p1',
    name: 'Terms and privacy review',
    vendor: 'Counsel',
    category: 'legal_admin' as const,
    amountCents: 30000,
    link: null,
    notes: null,
    createdByMemberId: STAFF_ID,
  };
  test('tomorrow is 400 "Date can\'t be in the future"; before November 2026 is 422', () => {
    const future = code(() => Expense.createOneOff({ ...base, spentOn: '2026-11-21' }, NOW, TODAY));
    expect(future).toEqual({
      code: 'VALIDATION_ERROR',
      details: { spentOn: "Date can't be in the future" },
    });
    expect(
      code(() => Expense.createOneOff({ ...base, spentOn: '2026-10-31' }, NOW, TODAY)).code,
    ).toBe('BEFORE_HISTORY_START');
  });

  test('edits may change amount and date, within the same limits', () => {
    const o = Expense.createOneOff({ ...base, spentOn: '2026-11-12' }, NOW, TODAY);
    const changes = o.editOneOff({ amountCents: 25000, spentOn: '2026-11-13' }, NOW, TODAY);
    expect(changes).toEqual({
      amountCents: { from: 30000, to: 25000 },
      spentOn: { from: '2026-11-12', to: '2026-11-13' },
    });
    expect(o.versions).toEqual([{ id: 'p1', effectiveFrom: '2026-11-13', amountCents: 25000 }]);
    expect(code(() => o.editOneOff({ spentOn: '2026-11-21' }, NOW, TODAY)).code).toBe(
      'VALIDATION_ERROR',
    );
  });
});

describe('FR-3: price versions, edits, end, delete', () => {
  test('a price change applies from its date; earlier Charges keep their amount', () => {
    const resend = bill('Resend', 'email', 2000, '2026-11-18');
    expect(
      resend.addPrice({ id: 'v2', effectiveFrom: '2026-12-18', amountCents: 2500 }, NOW),
    ).toEqual({
      oldCents: 2000,
    });
    expect(resend.chargesIn('2026-11', '2026-12-31')).toEqual([
      { date: '2026-11-18', amountCents: 2000 },
    ]);
    expect(resend.chargesIn('2026-12', '2026-12-31')).toEqual([
      { date: '2026-12-18', amountCents: 2500 },
    ]);
    expect(resend.currentAmount(TODAY)).toBe(2000);
    expect(resend.currentAmount('2026-12-18')).toBe(2500);
  });

  test('the same date replaces that version; before the start is 422 EFFECTIVE_BEFORE_START', () => {
    const b = bill('Resend', 'email', 2000, '2026-11-18', {
      prices: [{ effectiveFrom: '2026-12-18', amountCents: 2500 }],
    });
    expect(
      b.addPrice({ id: 'x', effectiveFrom: '2026-12-18', amountCents: 3000 }, NOW).oldCents,
    ).toBe(2500);
    expect(b.versions.map((v) => [v.effectiveFrom, v.amountCents])).toEqual([
      ['2026-11-18', 2000],
      ['2026-12-18', 3000],
    ]);
    expect(
      code(() => b.addPrice({ id: 'y', effectiveFrom: '2026-11-17', amountCents: 1 }, NOW)).code,
    ).toBe('EFFECTIVE_BEFORE_START');
  });

  test('a One-off has no price changes (409 NOT_RECURRING)', () => {
    const o = oneOff('X', 'other', 100, '2026-11-12');
    expect(
      code(() => o.addPrice({ id: 'y', effectiveFrom: '2026-11-15', amountCents: 1 }, NOW)).code,
    ).toBe('NOT_RECURRING');
  });

  test('removing a version: not the first (409), unknown date 404', () => {
    const b = bill('Resend', 'email', 2000, '2026-11-18', {
      prices: [{ effectiveFrom: '2026-12-18', amountCents: 2500 }],
    });
    expect(code(() => b.removePrice('2026-11-18', NOW)).code).toBe('FIRST_VERSION');
    expect(code(() => b.removePrice('2026-12-01', NOW)).code).toBe('NOT_FOUND');
    expect(b.removePrice('2026-12-18', NOW).amountCents).toBe(2500);
    expect(b.versions).toHaveLength(1);
  });

  test('FR-13: an edit reports each changed field from/to', () => {
    const b = bill('Figma', 'other', 1500, '2026-11-20');
    expect(b.editRecurring({ category: 'software_tools', name: 'Figma' }, NOW)).toEqual({
      category: { from: 'other', to: 'software_tools' },
    });
    expect(b.category).toBe('software_tools');
    expect(code(() => b.editRecurring({ endsOn: '2026-11-19' }, NOW)).details).toHaveProperty(
      'endsOn',
    );
    expect(code(() => b.editRecurring({ coversProvider: 'Apify' }, NOW)).code).toBe(
      'COVERS_PROVIDER_CATEGORY',
    );
  });

  test('ending and resuming a bill', () => {
    const b = bill('A', 'hosting', 100, '2026-11-05');
    expect(b.editRecurring({ endsOn: '2026-12-31' }, NOW)).toEqual({
      endsOn: { from: null, to: '2026-12-31' },
    });
    expect(b.chargesIn('2027-01', '2027-01-31')).toEqual([]);
    b.editRecurring({ endsOn: null }, NOW);
    expect(b.chargesIn('2027-01', '2027-01-31')).toHaveLength(1);
  });

  test('delete: a bill that has charged is 409 HAS_CHARGES; one that has not, and a One-off, can go', () => {
    expect(code(() => bill('A', 'hosting', 100, '2026-11-05').markDeleted(NOW, TODAY)).code).toBe(
      'HAS_CHARGES',
    );
    const later = bill('B', 'hosting', 100, '2026-11-25');
    later.markDeleted(NOW, TODAY);
    expect(later.isDeleted).toBe(true);
    const o = oneOff('C', 'other', 100, '2026-11-12');
    o.markDeleted(NOW, TODAY);
    expect(o.isDeleted).toBe(true);
  });
});
