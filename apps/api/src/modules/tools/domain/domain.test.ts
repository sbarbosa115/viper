import { describe, expect, test } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors.js';
import { canonicalJson } from './canonical-json.js';
import { TOOL_CATALOG } from './catalog.js';
import { toolHealth } from './health.js';
import { RateCard, TARGET_MARGIN_PCT } from './rate-card.js';
import { Tool } from './tool.js';
import { ALL_TOOL_KEYS } from './tool-keys.js';

const now = new Date('2026-11-19T10:00:00.000Z');

function places(overrides: Partial<Parameters<typeof Tool.define>[0]> = {}): Tool {
  return Tool.define({
    key: 'google.places-text-search',
    name: 'Google Places Text Search',
    provider: 'Google Maps Platform',
    unit: 'request',
    creditsPerUnit: 1.5,
    providerCostMicrosPerUnit: 5_000,
    enabled: true,
    maxUnitsPerCall: 20,
    updatedAt: now,
    ...overrides,
  });
}

describe('FR-23: Rate card', () => {
  test('20 units at 1.5 credits/unit meter 30,000 millicredits', () => {
    const card = RateCard.of({ creditsPerUnit: 1.5, providerCostMicrosPerUnit: 0 });
    expect(card.millicreditsFor(20)).toBe(30_000);
  });

  test('three decimals are exact (0.003 × 7 = 21 millicredits)', () => {
    expect(
      RateCard.of({ creditsPerUnit: 0.003, providerCostMicrosPerUnit: 0 }).millicreditsFor(7),
    ).toBe(21);
  });

  test.each([-1, 0.0005, 10_000.5, Number.NaN])('rejects credits per unit %s', (credits) => {
    expect(() => RateCard.of({ creditsPerUnit: credits, providerCostMicrosPerUnit: 0 })).toThrow(
      ValidationError,
    );
  });

  test.each([-1, 1.5, 100_000_001])('rejects provider cost %s', (cost) => {
    expect(() => RateCard.of({ creditsPerUnit: 1, providerCostMicrosPerUnit: cost })).toThrow(
      ValidationError,
    );
  });

  test('margin = 1 − provider cost ÷ (credits × $0.01)', () => {
    // 9 credits = $0.09 = 90,000 micros; cost 35,000 → 61.1%
    expect(RateCard.of({ creditsPerUnit: 9, providerCostMicrosPerUnit: 35_000 }).marginPct()).toBe(
      61.1,
    );
    expect(
      RateCard.of({ creditsPerUnit: 0, providerCostMicrosPerUnit: 10 }).marginPct(),
    ).toBeNull();
    expect(RateCard.of({ creditsPerUnit: 1, providerCostMicrosPerUnit: 20_000 }).marginPct()).toBe(
      -100,
    );
  });

  test('the seeded Rate card covers every Tool with at least 60% margin', () => {
    expect(TOOL_CATALOG.map((d) => d.key).sort()).toEqual([...ALL_TOOL_KEYS].sort());
    for (const d of TOOL_CATALOG) {
      const margin = RateCard.of(d).marginPct();
      expect(margin, d.key).not.toBeNull();
      expect(margin ?? 0, d.key).toBeGreaterThanOrEqual(TARGET_MARGIN_PCT);
    }
  });
});

describe('FR-23: Tool', () => {
  test('Staff changes report the changed fields and touch updatedAt', () => {
    const tool = places();
    const later = new Date('2026-11-20T00:00:00.000Z');
    expect(tool.change({ enabled: false, creditsPerUnit: 2 }, later)).toEqual([
      'enabled',
      'creditsPerUnit',
    ]);
    expect(tool.enabled).toBe(false);
    expect(tool.rateCard.creditsPerUnit).toBe(2);
    expect(tool.updatedAt).toEqual(later);
  });

  test('a change to the same values changes nothing', () => {
    const tool = places();
    expect(tool.change({ enabled: true, creditsPerUnit: 1.5 }, new Date(0))).toEqual([]);
    expect(tool.updatedAt).toEqual(now);
  });

  test('an invalid price is rejected and leaves the Tool unchanged', () => {
    const tool = places();
    expect(() => tool.change({ creditsPerUnit: 1.2345 }, now)).toThrow(ValidationError);
    expect(tool.rateCard.creditsPerUnit).toBe(1.5);
  });

  test('max cost is capped at max units per call', () => {
    expect(places().maxCostMillicredits(50)).toBe(20 * 1_500);
  });

  test('max units per call must be positive', () => {
    expect(() => places({ maxUnitsPerCall: 0 })).toThrow(ValidationError);
  });
});

describe('FR-23: health', () => {
  test('error rate in % with one decimal, null without calls', () => {
    expect(toolHealth({ calls: 3, errors: 1, lastErrorAt: now, lastError: 'boom' })).toEqual({
      calls24h: 3,
      errorRate24h: 33.3,
      lastErrorAt: now,
      lastError: 'boom',
    });
    expect(
      toolHealth({ calls: 0, errors: 0, lastErrorAt: null, lastError: null }).errorRate24h,
    ).toBeNull();
  });
});

describe('FR-36: canonical input', () => {
  test('key order and undefined members do not change the text', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(
      canonicalJson({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }),
    );
  });
});
