import { describe, expect, test } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors.js';
import { csvFileName, csvSafe, slugOf } from './csv.js';
import { compareLeads, cursorAfter, feedbackOf, isAfterCursor, type LeadListRow } from './lead.js';
import { distanceMeters, domainOf, normaliseName, normalisePhone } from './normalise.js';
import { Prospect, selectForDelivery, type ProspectInput, type SourceRef } from './prospect.js';

const SRC: SourceRef = {
  name: 'Google Maps',
  url: 'https://maps.example/1',
  retrievedAt: '2026-11-19T10:00:00.000Z',
};
const ZB: SourceRef = { name: 'ZeroBounce', url: null, retrievedAt: '2026-11-19T10:05:00.000Z' };
const NOW = new Date('2026-11-19T10:00:00.000Z');
let n = 0;

function found(input: Partial<ProspectInput> = {}): Prospect {
  n += 1;
  return Prospect.found({
    id: `p-${n}`,
    runId: 'run-1',
    businessId: 'b-1',
    input: { name: 'Sweet Crumbs Bakery', placeKeys: [`google:${n}`], source: SRC, ...input },
    now: NOW,
  });
}

/** A Prospect that passes every FR-25 rule unless the patch says otherwise. */
function qualified(fitScore = 85, input: Partial<ProspectInput> = {}): Prospect {
  const p = found(input);
  p.apply({
    fitScore,
    pitch: { productId: null, productName: 'Cane sugar', reason: 'Bakes daily' },
    contacts: [
      { type: 'email', value: 'hello@sweet.example', verification: 'verified', source: ZB },
    ],
  });
  return p;
}

const rules = { minFitScore: 60, deliveredKeys: new Set<string>() };

describe('FR-19 Step 3: normalisation', () => {
  test('phones become +1 and 10 digits; short numbers are not phones', () => {
    expect(normalisePhone('(512) 555-0101')).toBe('+15125550101');
    expect(normalisePhone('1-512-555-0101')).toBe('+15125550101');
    expect(normalisePhone('+44 20 7946 0000')).toBe('+442079460000');
    expect(normalisePhone('555')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });

  test('domains drop scheme, www and paths; shared hosts are not a business domain', () => {
    expect(domainOf('https://www.SweetCrumbs.example/menu')).toBe('sweetcrumbs.example');
    expect(domainOf('sweetcrumbs.example')).toBe('sweetcrumbs.example');
    expect(domainOf('https://www.facebook.com/sweetcrumbs')).toBeNull();
    expect(domainOf('https://instagram.com/sweet')).toBeNull();
    expect(domainOf('not a url')).toBeNull();
  });

  test('names ignore case, accents, punctuation, & and legal suffixes', () => {
    expect(normaliseName('Barton Hills Pâtisserie, LLC')).toBe(
      normaliseName('barton hills patisserie'),
    );
    expect(normaliseName('Flour & Fig')).toBe('flour and fig');
  });

  test('distance in metres', () => {
    const d = distanceMeters({ lat: 30.2624, lng: -97.7262 }, { lat: 30.2627, lng: -97.7262 });
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(40);
  });
});

describe('FR-19 Step 3: merge rules', () => {
  test('same place id', () => {
    expect(
      found({ placeKeys: ['google:A'] }).isSamePlaceAs(found({ placeKeys: ['google:A', 'osm:1'] })),
    ).toBe(true);
  });

  test('same normalised phone', () => {
    const a = found({ phone: '(512) 555-0101' });
    const b = found({ name: 'Other name', phone: '+1 512 555 0101' });
    expect(a.isSamePlaceAs(b)).toBe(true);
  });

  test('same domain', () => {
    const a = found({ website: 'https://sweetcrumbs.example' });
    const b = found({ name: 'Different', website: 'www.sweetcrumbs.example/about' });
    expect(a.isSamePlaceAs(b)).toBe(true);
  });

  test('same name within 50 m, but not 200 m away or with another name', () => {
    const a = found({ lat: 30.2624, lng: -97.7262 });
    expect(
      a.isSamePlaceAs(found({ name: 'SWEET CRUMBS BAKERY', lat: 30.2627, lng: -97.7262 })),
    ).toBe(true);
    expect(a.isSamePlaceAs(found({ lat: 30.2642, lng: -97.7262 }))).toBe(false);
    expect(a.isSamePlaceAs(found({ name: 'Flour & Fig', lat: 30.2624, lng: -97.7262 }))).toBe(
      false,
    );
  });

  test('different places with nothing in common are kept apart', () => {
    expect(found({ phone: '512-555-0101' }).isSamePlaceAs(found({ phone: '512-555-0102' }))).toBe(
      false,
    );
  });

  test('absorb combines keys, contacts and Sources and keeps known facts', () => {
    const a = found({ placeKeys: ['google:A'], address: '1 Main St' });
    const b = found({
      placeKeys: ['osm:node/1'],
      address: 'Other',
      phone: '512-555-0101',
      category: 'Bakery',
      source: { ...SRC, name: 'OpenStreetMap' },
    });
    a.absorb(b);
    const s = a.toSnapshot();
    expect(s.placeKeys).toEqual(['google:A', 'osm:node/1', 'phone:+15125550101']);
    expect(s.address).toBe('1 Main St');
    expect(s.category).toBe('Bakery');
    expect(s.contacts.map((c) => c.type)).toEqual(['phone']);
    expect(s.sources.map((x) => x.name)).toEqual(['Google Maps', 'OpenStreetMap']);
  });

  test('a Prospect needs a name and some key', () => {
    expect(() => found({ name: ' ' })).toThrow(ValidationError);
    expect(() => found({ placeKeys: [] })).toThrow(ValidationError);
  });
});

describe('FR-19 Steps 4–9: updating a Prospect', () => {
  test('stages follow the scores', () => {
    const p = found();
    expect(p.stage).toBe('new');
    p.apply({ preScore: 70 });
    expect(p.stage).toBe('pre_scored');
    p.apply({ fitScore: 80 });
    expect(p.stage).toBe('scored');
  });

  test('a check result replaces an unchecked contact; an unchecked sighting never downgrades', () => {
    const p = found({ phone: '512-555-0101' });
    p.apply({
      contacts: [
        {
          type: 'phone',
          value: '+15125550101',
          verification: 'verified',
          source: ZB,
          checked: true,
        },
      ],
    });
    p.apply({
      contacts: [
        { type: 'phone', value: '(512) 555-0101', verification: 'unverified', source: SRC },
      ],
    });
    const [phone] = p.toSnapshot().contacts;
    expect(phone?.verification).toBe('verified');
    expect(phone?.source.name).toBe('ZeroBounce');
  });

  test('returns email and phone check results for lead_contact_verified', () => {
    const checks = found().apply({
      contacts: [
        { type: 'email', value: 'a@x.example', verification: 'invalid', source: ZB, checked: true },
        {
          type: 'phone',
          value: '5125550101',
          verification: 'unverified',
          source: ZB,
          checked: true,
        },
        { type: 'email', value: 'b@x.example', verification: 'unverified', source: SRC },
        {
          type: 'website',
          value: 'x.example',
          verification: 'verified',
          source: SRC,
          checked: true,
        },
      ],
    });
    expect(checks).toEqual([
      { type: 'email', result: 'invalid' },
      { type: 'phone', result: 'unknown' },
    ]);
  });

  test('a website found later sets the domain key', () => {
    const p = found();
    p.apply({ website: { url: 'https://flourfig.example', summary: 'Bakes daily', source: SRC } });
    expect(p.toSnapshot().domain).toBe('flourfig.example');
    expect(p.placeKeys).toContain('domain:flourfig.example');
  });

  test('scores, Evidence points and Pitches are validated', () => {
    expect(() => found().apply({ fitScore: 101 })).toThrow(ValidationError);
    expect(() => found().apply({ preScore: 1.5 })).toThrow(ValidationError);
    expect(() => found().apply({ evidence: [{ fact: 'x', points: 41, source: SRC }] })).toThrow(
      ValidationError,
    );
    expect(() =>
      found().apply({ pitch: { productId: null, productName: '', reason: 'x' } }),
    ).toThrow(ValidationError);
    expect(() =>
      found().apply({
        evidence: [{ fact: 'x', points: 5, source: { ...SRC, retrievedAt: 'nope' } }],
      }),
    ).toThrow(ValidationError);
  });

  test('long facts are cut to 300 characters', () => {
    const p = found();
    p.apply({ evidence: [{ fact: 'a'.repeat(400), points: 10, source: SRC }] });
    expect(p.toSnapshot().evidence[0]?.fact).toHaveLength(300);
  });
});

describe('FR-25: qualification', () => {
  test('a scored business with a verified email above the minimum qualifies', () => {
    expect(qualified().notDeliveredReason(rules)).toBeNull();
  });

  test('AC: Fit score 85 but only an invalid email and no phone → not delivered', () => {
    const p = found();
    p.apply({
      fitScore: 85,
      pitch: { productId: null, productName: 'Cane sugar', reason: 'Bakes daily' },
      contacts: [
        {
          type: 'email',
          value: 'bad@x.example',
          verification: 'invalid',
          source: ZB,
          checked: true,
        },
      ],
    });
    expect(p.notDeliveredReason(rules)).toBe('no_verified_contact');
  });

  test('unverified contacts alone do not qualify; a verified phone does', () => {
    const p = found({ phone: '512-555-0101' });
    p.apply({ fitScore: 90, pitch: { productId: null, productName: 'Sugar', reason: 'r' } });
    expect(p.notDeliveredReason(rules)).toBe('no_verified_contact');
    p.apply({
      contacts: [{ type: 'phone', value: '5125550101', verification: 'verified', source: ZB }],
    });
    expect(p.notDeliveredReason(rules)).toBeNull();
  });

  test('a verified website is not a verified phone or email', () => {
    const p = found();
    p.apply({
      fitScore: 90,
      pitch: { productId: null, productName: 'Sugar', reason: 'r' },
      contacts: [{ type: 'website', value: 'x.example', verification: 'verified', source: SRC }],
    });
    expect(p.notDeliveredReason(rules)).toBe('no_verified_contact');
  });

  test('below the Plan minimum, unscored, without a Pitch, home listings and delivered places are not delivered', () => {
    expect(qualified(59).notDeliveredReason(rules)).toBe('below_min_score');
    expect(qualified(60).notDeliveredReason(rules)).toBeNull();
    expect(found().notDeliveredReason(rules)).toBe('not_scored');
    const noPitch = found();
    noPitch.apply({ fitScore: 90 });
    expect(noPitch.notDeliveredReason(rules)).toBe('no_pitch');
    expect(qualified(90, { listing: 'home' }).notDeliveredReason(rules)).toBe('not_a_business');
    const p = qualified(90, { placeKeys: ['google:X', 'osm:9'] });
    expect(p.notDeliveredReason({ ...rules, deliveredKeys: new Set(['osm:9']) })).toBe(
      'already_delivered',
    );
  });

  test('invalid contacts are dropped from the Lead, unverified kept', () => {
    const p = qualified(80, { phone: '512-555-0101' });
    p.apply({
      contacts: [{ type: 'email', value: 'old@x.example', verification: 'invalid', source: ZB }],
    });
    expect(p.deliverableContacts().map((c) => [c.type, c.verification])).toEqual([
      ['phone', 'unverified'],
      ['email', 'verified'],
    ]);
  });

  test('ranked by Fit score and capped at capacity', () => {
    const ps = [qualified(70), qualified(95), qualified(40), qualified(88), qualified(66)];
    const chosen = selectForDelivery(ps, { ...rules, capacity: 3 });
    expect(chosen.map((p) => p.fitScore)).toEqual([95, 88, 70]);
  });

  test('two Prospects for the same place key are delivered once', () => {
    const a = qualified(90, { placeKeys: ['google:Z'] });
    const b = qualified(80, { placeKeys: ['google:Z'], name: 'Other' });
    expect(selectForDelivery([a, b], { ...rules, capacity: 10 })).toEqual([a]);
  });

  test('placeKey prefers a provider key over derived ones', () => {
    expect(found({ placeKeys: [], phone: '512-555-0101', website: 'a.example' }).placeKey).toBe(
      'phone:+15125550101',
    );
    expect(found({ placeKeys: ['osm:1'], phone: '512-555-0101' }).placeKey).toBe('osm:1');
  });
});

describe('FR-26: Lead order and cursors', () => {
  const row = (
    id: string,
    fitScore: number,
    distanceMiles: number | null,
    at: string,
  ): LeadListRow => ({
    id,
    runId: 'r',
    name: id,
    category: null,
    distanceMiles,
    fitScore,
    feedback: null,
    deliveredAt: new Date(at),
    contactTypes: [],
  });
  const rows = [
    row('a', 80, 2, '2026-11-01T00:00:00.000Z'),
    row('b', 90, null, '2026-11-02T00:00:00.000Z'),
    row('c', 80, 1, '2026-11-03T00:00:00.000Z'),
    row('d', 70, 0.5, '2026-11-02T00:00:00.000Z'),
  ];
  const order = (sort: 'score' | 'distance' | 'newest') =>
    [...rows].sort((x, y) => compareLeads(sort, x, y)).map((r) => r.id);

  test('score desc, distance asc with unknown last, newest first; ties by id', () => {
    expect(order('score')).toEqual(['b', 'a', 'c', 'd']);
    expect(order('distance')).toEqual(['d', 'c', 'a', 'b']);
    expect(order('newest')).toEqual(['c', 'b', 'd', 'a']);
  });

  test('isAfterCursor continues each order exactly', () => {
    for (const sort of ['score', 'distance', 'newest'] as const) {
      const sorted = [...rows].sort((x, y) => compareLeads(sort, x, y));
      const cut = sorted[1];
      if (!cut) throw new Error('fixture');
      const cursor = cursorAfter(sort, cut);
      expect(
        rows.filter((r) => isAfterCursor(r, cursor)).sort((x, y) => compareLeads(sort, x, y)),
      ).toEqual(sorted.slice(2));
    }
  });
});

describe('FR-27: Feedback', () => {
  test('good drops a reason; not a fit keeps it; null clears', () => {
    expect(feedbackOf('good', 'Closed')).toEqual({ value: 'good', reason: null });
    expect(feedbackOf('not_fit', ' Closed ')).toEqual({ value: 'not_fit', reason: 'Closed' });
    expect(feedbackOf('not_fit', '')).toEqual({ value: 'not_fit', reason: null });
    expect(feedbackOf(null, 'x')).toBeNull();
  });

  test('reasons longer than 200 characters are rejected', () => {
    expect(() => feedbackOf('not_fit', 'x'.repeat(201))).toThrow(ValidationError);
  });
});

describe('FR-28: CSV rules', () => {
  test('values starting with = + - @ are prefixed with a quote', () => {
    expect(csvSafe('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(csvSafe('+1 512')).toBe(`'+1 512`);
    expect(csvSafe('-2')).toBe(`'-2`);
    expect(csvSafe('@sweet')).toBe(`'@sweet`);
    expect(csvSafe('Sweet Crumbs')).toBe('Sweet Crumbs');
  });

  test('file name llyner-leads-<plan-slug>-<yyyy-mm-dd>.csv', () => {
    expect(csvFileName('Bakeries near Austin', new Date('2026-11-19T23:59:00.000Z'))).toBe(
      'llyner-leads-bakeries-near-austin-2026-11-19.csv',
    );
    expect(slugOf('Cafés & Pâtisseries!')).toBe('cafes-and-patisseries');
    expect(slugOf('!!!')).toBe('plan');
  });
});
