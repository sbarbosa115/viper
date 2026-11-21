import { describe, expect, test } from 'vitest';
import { businessMinutesBetween, median, supportDate } from './business-time.js';

const at = (iso: string) => new Date(iso);

describe('businessMinutesBetween: Mon–Fri 09:00–17:00 America/Chicago', () => {
  test.each([
    // label, from, to, minutes
    ['inside one day (CST)', '2026-11-20T15:00:00Z', '2026-11-20T15:50:00Z', 50],
    [
      'a full Friday (09:00–17:00 CST = 15:00–23:00Z)',
      '2026-11-20T00:00:00Z',
      '2026-11-21T06:00:00Z',
      480,
    ],
    ['before 09:00 counts from 09:00', '2026-11-20T13:00:00Z', '2026-11-20T15:30:00Z', 30],
    ['after 17:00 counts nothing', '2026-11-20T23:30:00Z', '2026-11-21T02:00:00Z', 0],
    ['across 17:00 stops at 17:00', '2026-11-20T22:30:00Z', '2026-11-21T01:00:00Z', 30],
    ['a whole weekend is 0', '2026-11-21T00:00:00Z', '2026-11-23T14:59:00Z', 0],
    ['Friday 16:00 → Monday 10:00 CST', '2026-11-20T22:00:00Z', '2026-11-23T16:00:00Z', 120],
    [
      'Monday 09:00 → Wednesday 09:00 (two full days)',
      '2026-11-23T15:00:00Z',
      '2026-11-25T15:00:00Z',
      960,
    ],
    ['a full week', '2026-11-16T00:00:00Z', '2026-11-23T00:00:00Z', 2400],
    ['to before from is 0', '2026-11-20T16:00:00Z', '2026-11-20T15:00:00Z', 0],
    ['seconds are floored', '2026-11-20T15:00:00Z', '2026-11-20T15:00:59Z', 0],
  ])('%s', (_label, from, to, minutes) => {
    expect(businessMinutesBetween(at(from), at(to))).toBe(minutes);
  });

  describe('DST', () => {
    test('2026-03-08 spring forward: Friday is CST (15:00Z), Monday is CDT (14:00Z)', () => {
      expect(businessMinutesBetween(at('2026-03-06T15:00:00Z'), at('2026-03-06T23:00:00Z'))).toBe(
        480,
      );
      expect(businessMinutesBetween(at('2026-03-09T14:00:00Z'), at('2026-03-09T22:00:00Z'))).toBe(
        480,
      );
      // 09:00 CDT is 14:00Z: one hour earlier than in winter.
      expect(businessMinutesBetween(at('2026-03-09T13:00:00Z'), at('2026-03-09T14:30:00Z'))).toBe(
        30,
      );
    });

    test('2026-03-08 spring forward: Friday 16:00 CST → Monday 10:00 CDT is 120', () => {
      expect(businessMinutesBetween(at('2026-03-06T22:00:00Z'), at('2026-03-09T15:00:00Z'))).toBe(
        120,
      );
    });

    test('2026-11-01 fall back: Friday 16:00 CDT → Monday 10:00 CST is 120', () => {
      expect(businessMinutesBetween(at('2026-10-30T21:00:00Z'), at('2026-11-02T16:00:00Z'))).toBe(
        120,
      );
      expect(businessMinutesBetween(at('2026-11-02T15:00:00Z'), at('2026-11-02T23:00:00Z'))).toBe(
        480,
      );
    });

    test('a span over the change counts each day in its own offset', () => {
      // Thu 2026-03-05 00:00Z → Wed 2026-03-11 00:00Z: Thu, Fri (CST), Mon, Tue (CDT).
      expect(businessMinutesBetween(at('2026-03-05T00:00:00Z'), at('2026-03-11T00:00:00Z'))).toBe(
        4 * 480,
      );
    });
  });
});

describe('median', () => {
  test.each([
    [[], null],
    [[30, 90, 600], 90],
    [[600, 30], 315],
    [[1, 2], 2],
    [[5], 5],
  ])('%j → %s', (values, expected) => {
    expect(median(values)).toBe(expected);
  });
});

describe('supportDate', () => {
  test('is the Chicago calendar date', () => {
    expect(supportDate(at('2026-11-21T05:59:00Z'))).toBe('2026-11-20');
    expect(supportDate(at('2026-11-21T06:00:00Z'))).toBe('2026-11-21');
  });
});
