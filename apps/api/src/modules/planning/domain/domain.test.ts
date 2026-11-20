import { describe, expect, test } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors.js';
import { draftRadius, normaliseDraft, radiusFromGoal } from './draft.js';
import { estimate } from './estimate.js';
import { Guardrails } from './guardrails.js';
import { Plan, type SegmentEdit } from './plan.js';
import { clampRadius, SearchArea } from './search-area.js';

const SUGAR = '00000000-0000-7000-8000-0000000000a1';
const POWDER = '00000000-0000-7000-8000-0000000000a2';
const products = new Set([SUGAR, POWDER]);
const ceilings = { maxCredits: 1000, maxLeads: 500 };
const t0 = new Date('2026-11-19T10:00:00.000Z');
const t1 = new Date('2026-11-19T11:00:00.000Z');
const t2 = new Date('2026-11-19T12:00:00.000Z');

function fieldsOf(fn: () => unknown): Record<string, unknown> {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return (e as ValidationError).details ?? {};
  }
  throw new Error('expected a ValidationError');
}

const area = () =>
  SearchArea.of({
    label: '1200 E 6th St, Austin, TX',
    lat: 30.2624,
    lng: -97.7262,
    radiusMiles: 3,
  });

function plan(): Plan {
  return Plan.create({
    id: 'plan-1',
    businessId: 'b-1',
    flowKey: 'local-buyers',
    name: 'Bakeries near Austin',
    goal: 'bakeries within 3 miles that could buy our sugar',
    segments: [
      {
        id: 'seg-1',
        name: 'Bakeries',
        fitSignals: ['Bakes on site'],
        exclusions: ['Chains'],
        productId: SUGAR,
      },
    ],
    searchArea: area(),
    guardrails: Guardrails.of({ maxCredits: 400, maxLeads: 100, minFitScore: 60 }, ceilings),
    productIds: products,
    now: t0,
  });
}

const edit = (p: Plan, change: Partial<SegmentEdit> = {}): SegmentEdit[] =>
  p.segments.map((s) => ({ ...s.toSnapshot(), ...change }));

describe('FR-16: Search area radius', () => {
  test('a drafted radius is clamped to 1–25 miles', () => {
    expect(clampRadius(0)).toBe(1);
    expect(clampRadius(30)).toBe(25);
    expect(clampRadius(3)).toBe(3);
    expect(clampRadius(2.26)).toBe(2.3);
  });

  test('radius from the drafted value, else parsed from the goal, else the delivery radius', () => {
    expect(draftRadius(5, 'within 3 miles', 10)).toBe(5);
    expect(draftRadius(null, 'bakeries within 3 miles', 10)).toBe(3);
    expect(draftRadius(null, 'cafés downtown', 10)).toBe(10);
    expect(draftRadius(null, 'cafés downtown', 0)).toBe(1);
    expect(draftRadius(null, 'cafés downtown', null)).toBe(1);
    expect(draftRadius(null, 'within 100 miles', 3)).toBe(25);
  });

  test('parses miles and kilometres from the goal', () => {
    expect(radiusFromGoal('within 3 miles')).toBe(3);
    expect(radiusFromGoal('a 5-mile radius')).toBe(5);
    expect(radiusFromGoal('10 mi around')).toBe(10);
    expect(radiusFromGoal('8 km')).toBeCloseTo(4.97, 2);
    expect(radiusFromGoal('bakeries nearby')).toBeNull();
  });
});

describe('FR-17: Search area edits', () => {
  test('a radius of 30 is rejected naming searchArea.radiusMiles', () => {
    expect(Object.keys(fieldsOf(() => area().withRadius(30)))).toEqual(['searchArea.radiusMiles']);
    expect(Object.keys(fieldsOf(() => area().withRadius(0.5)))).toEqual(['searchArea.radiusMiles']);
  });

  test('moving keeps the radius', () => {
    const moved = area().movedTo({ label: 'Austin, TX', lat: 30.2672, lng: -97.7431 });
    expect(moved.toSnapshot()).toEqual({
      label: 'Austin, TX',
      lat: 30.2672,
      lng: -97.7431,
      radiusMiles: 3,
    });
  });
});

describe('FR-16: default Guardrails', () => {
  const defaults = { maxCredits: 400, maxLeads: 100, minFitScore: 60 };

  test('come from the flow plan defaults', () => {
    expect(Guardrails.defaults(defaults, ceilings, 863).toSnapshot()).toEqual(defaults);
  });

  test('max credits is the available balance when it is lower (trial Business with 50)', () => {
    expect(Guardrails.defaults(defaults, ceilings, 50).maxCredits).toBe(50);
  });

  test('max credits is never below 10', () => {
    expect(Guardrails.defaults(defaults, ceilings, 3).maxCredits).toBe(10);
    expect(Guardrails.defaults(defaults, ceilings, -20).maxCredits).toBe(10);
  });

  test('defaults stay within the ceilings', () => {
    const g = Guardrails.defaults(defaults, { maxCredits: 300, maxLeads: 50 }, 863);
    expect(g.toSnapshot()).toEqual({ maxCredits: 300, maxLeads: 50, minFitScore: 60 });
  });
});

describe('FR-17: Guardrails edits', () => {
  test.each([
    [{ maxCredits: 9, maxLeads: 100, minFitScore: 60 }, 'guardrails.maxCredits'],
    [{ maxCredits: 1001, maxLeads: 100, minFitScore: 60 }, 'guardrails.maxCredits'],
    [{ maxCredits: 400, maxLeads: 501, minFitScore: 60 }, 'guardrails.maxLeads'],
    [{ maxCredits: 400, maxLeads: 9, minFitScore: 60 }, 'guardrails.maxLeads'],
    [{ maxCredits: 400, maxLeads: 100, minFitScore: 39 }, 'guardrails.minFitScore'],
    [{ maxCredits: 400, maxLeads: 100, minFitScore: 91 }, 'guardrails.minFitScore'],
    [{ maxCredits: 10.5, maxLeads: 100, minFitScore: 60 }, 'guardrails.maxCredits'],
  ])('%o is rejected naming %s', (values, field) => {
    expect(Object.keys(fieldsOf(() => Guardrails.of(values, ceilings)))).toEqual([field]);
  });

  test('the bounds themselves are accepted', () => {
    expect(() =>
      Guardrails.of({ maxCredits: 1000, maxLeads: 500, minFitScore: 90 }, ceilings),
    ).not.toThrow();
    expect(() =>
      Guardrails.of({ maxCredits: 10, maxLeads: 10, minFitScore: 40 }, ceilings),
    ).not.toThrow();
  });
});

describe('FR-17: estimate', () => {
  test('typical is the flow median when there are enough runs', () => {
    expect(estimate(400, 137)).toEqual({ maxCredits: 400, typicalCredits: 137 });
  });

  test('typical is 60% of max credits with too few runs', () => {
    expect(estimate(400, null)).toEqual({ maxCredits: 400, typicalCredits: 240 });
    expect(estimate(50, null)).toEqual({ maxCredits: 50, typicalCredits: 30 });
  });

  test('typical never exceeds max credits', () => {
    expect(estimate(50, 137)).toEqual({ maxCredits: 50, typicalCredits: 50 });
  });
});

describe('FR-16: Plan rules', () => {
  test('a new Plan has not had its ICP edited', () => {
    const p = plan();
    expect(p.icpEdited).toBe(false);
    expect(p.createdAt).toEqual(t0);
  });

  test('needs 1–5 segments', () => {
    const base = plan().toSnapshot();
    const make = (n: number) =>
      Plan.create({
        ...base,
        segments: Array.from({ length: n }, (_, i) => ({ ...base.segments[0]!, id: `s${i}` })),
        searchArea: area(),
        guardrails: plan().guardrails,
        productIds: products,
        now: t0,
      });
    expect(Object.keys(fieldsOf(() => make(0)))).toEqual(['segments']);
    expect(Object.keys(fieldsOf(() => make(6)))).toEqual(['segments']);
    expect(make(5).segments).toHaveLength(5);
  });

  test('a segment needs 1–6 Fit signals, ≤ 5 exclusions and a profile Product', () => {
    const p = plan();
    const ctx = { productIds: products, newId: () => 'new', now: t1 };
    expect(fieldsOf(() => p.replaceSegments(edit(p, { fitSignals: [] }), ctx))).toHaveProperty([
      'segments.0.fitSignals',
    ]);
    expect(
      fieldsOf(() =>
        p.replaceSegments(edit(p, { fitSignals: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), ctx),
      ),
    ).toHaveProperty(['segments.0.fitSignals']);
    expect(
      fieldsOf(() =>
        p.replaceSegments(edit(p, { exclusions: ['a', 'b', 'c', 'd', 'e', 'f'] }), ctx),
      ),
    ).toHaveProperty(['segments.0.exclusions']);
    expect(fieldsOf(() => p.replaceSegments(edit(p, { productId: 'other' }), ctx))).toHaveProperty([
      'segments.0.productId',
    ]);
    expect(fieldsOf(() => p.replaceSegments(edit(p, { name: ' ' }), ctx))).toHaveProperty([
      'segments.0.name',
    ]);
    expect(fieldsOf(() => p.replaceSegments(edit(p, { id: 'nope' }), ctx))).toHaveProperty([
      'segments.0.id',
    ]);
  });

  test('a rejected edit changes nothing', () => {
    const p = plan();
    const before = p.toSnapshot();
    expect(() =>
      p.replaceSegments(edit(p, { fitSignals: [] }), {
        productIds: products,
        newId: () => 'x',
        now: t1,
      }),
    ).toThrow(ValidationError);
    expect(p.toSnapshot()).toEqual(before);
  });

  test('renames with 1–60 characters', () => {
    const p = plan();
    p.rename('  Bakeries east  ', t1);
    expect(p.name).toBe('Bakeries east');
    expect(p.updatedAt).toEqual(t1);
    expect(Object.keys(fieldsOf(() => p.rename('x'.repeat(61), t1)))).toEqual(['name']);
  });
});

describe('FR-17: first ICP edit', () => {
  const ctx = (now: Date) => ({ productIds: products, newId: () => 'seg-new', now });

  test('changing a Fit signal sets icpEditedAt and reports fit_signals', () => {
    const p = plan();
    const field = p.replaceSegments(edit(p, { fitSignals: ['Bakes bread daily'] }), ctx(t1));
    expect(field).toBe('fit_signals');
    expect(p.icpEditedAt).toEqual(t1);
  });

  test('icpEditedAt stays set (and unchanged) on later edits, which report nothing', () => {
    const p = plan();
    p.replaceSegments(edit(p, { fitSignals: ['Bakes bread daily'] }), ctx(t1));
    const again = p.replaceSegments(edit(p, { exclusions: ['Grocery stores'] }), ctx(t2));
    expect(again).toBeNull();
    expect(p.icpEditedAt).toEqual(t1);
    expect(p.icpEdited).toBe(true);
  });

  test('saving the same segments is not an ICP edit', () => {
    const p = plan();
    expect(p.replaceSegments(edit(p), ctx(t1))).toBeNull();
    expect(p.icpEditedAt).toBeNull();
  });

  test.each([
    [
      'segments',
      (p: Plan) => [
        ...edit(p),
        { name: 'Cafés', fitSignals: ['Bakes'], exclusions: [], productId: SUGAR },
      ],
    ],
    ['segments', (p: Plan) => edit(p, { name: 'Bakers' })],
    ['exclusions', (p: Plan) => edit(p, { exclusions: [] })],
    ['product', (p: Plan) => edit(p, { productId: POWDER })],
  ] as const)('reports %s', (field, edits) => {
    const p = plan();
    expect(p.replaceSegments(edits(p), ctx(t1))).toBe(field);
  });

  test('new segments get new ids; Search area and Guardrails edits are not ICP edits', () => {
    const p = plan();
    p.replaceSegments(
      [...edit(p), { name: 'Cafés', fitSignals: ['Bakes'], exclusions: [], productId: SUGAR }],
      ctx(t1),
    );
    expect(p.segments.map((s) => s.id)).toEqual(['seg-1', 'seg-new']);
    const q = plan();
    q.changeSearchArea(area().withRadius(5), t1);
    q.changeGuardrails(
      Guardrails.of({ maxCredits: 300, maxLeads: 50, minFitScore: 70 }, ceilings),
      t1,
    );
    expect(q.icpEditedAt).toBeNull();
    expect(q.searchArea.radiusMiles).toBe(5);
    expect(q.guardrails.maxCredits).toBe(300);
  });

  test('restore round-trips the snapshot', () => {
    const p = plan();
    p.replaceSegments(edit(p, { fitSignals: ['Bakes bread daily'] }), ctx(t1));
    expect(Plan.restore(p.toSnapshot()).toSnapshot()).toEqual(p.toSnapshot());
    expect(p.usesProduct(SUGAR)).toBe(true);
    expect(p.usesProduct(POWDER)).toBe(false);
  });
});

describe('FR-16: drafted Plans follow the rules', () => {
  let n = 0;
  const ctx = {
    goal: 'bakeries within 3 miles',
    productIds: [SUGAR, POWDER],
    newId: () => `d${++n}`,
  };

  test('trims, caps and falls back to the first Product', () => {
    const draft = normaliseDraft(
      {
        name: `  ${'N'.repeat(70)} `,
        segments: [
          ...Array.from({ length: 6 }, (_, i) => ({
            name: ` Segment ${i} `,
            fitSignals: ['a', ' ', 'b', 'c', 'd', 'e', 'f', 'g'],
            exclusions: ['1', '2', '3', '4', '5', '6'],
            productId: i === 0 ? 'unknown' : POWDER,
          })),
        ],
        place: null,
        radiusMiles: null,
      },
      ctx,
    );
    expect(draft?.name).toHaveLength(60);
    expect(draft?.segments).toHaveLength(5);
    expect(draft?.segments[0]).toMatchObject({
      name: 'Segment 0',
      fitSignals: ['a', 'b', 'c', 'd', 'e', 'f'],
      exclusions: ['1', '2', '3', '4', '5'],
      productId: SUGAR,
    });
    expect(draft?.segments[1]?.productId).toBe(POWDER);
  });

  test('drops segments without a name or Fit signal; null when none is left', () => {
    const bad = { name: '', fitSignals: [], exclusions: [], productId: SUGAR };
    expect(
      normaliseDraft({ name: 'x', segments: [bad], place: null, radiusMiles: null }, ctx),
    ).toBeNull();
    const draft = normaliseDraft(
      {
        name: '',
        segments: [bad, { ...bad, name: 'Cafés', fitSignals: ['Bakes'] }],
        place: null,
        radiusMiles: null,
      },
      ctx,
    );
    expect(draft?.segments.map((s) => s.name)).toEqual(['Cafés']);
    expect(draft?.name).toBe('bakeries within 3 miles');
  });

  test('null without Products', () => {
    expect(
      normaliseDraft(
        {
          name: 'x',
          segments: [{ name: 'a', fitSignals: ['b'], exclusions: [], productId: 'p' }],
          place: null,
          radiusMiles: null,
        },
        { ...ctx, productIds: [] },
      ),
    ).toBeNull();
  });
});
