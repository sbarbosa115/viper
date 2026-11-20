import { describe, expect, test } from 'vitest';
import type { LeadRecord } from '../domain/lead.js';
import { leadOf } from './views.js';

const source = {
  name: 'Website',
  url: 'https://bakery.test',
  retrievedAt: '2026-11-19T10:00:00.000Z',
};

function lead(evidence: LeadRecord['evidence']): LeadRecord {
  return {
    id: 'lead-1',
    businessId: 'b',
    planId: 'p',
    runId: 'r',
    prospectId: 'pr',
    placeKey: 'google:1',
    name: 'Rise Bakery',
    category: 'Bakery',
    address: null,
    distanceMiles: 1.2,
    fitScore: 80,
    pitch: { productId: 'x', productName: 'Cane sugar', reason: 'Bakes daily' },
    feedback: null,
    feedbackReason: null,
    feedbackAt: null,
    deliveredAt: new Date('2026-11-19T10:00:00.000Z'),
    contacts: [],
    evidence,
  };
}

describe('FR-26: Evidence on a Lead', () => {
  test('Evidence worth 0 points is not shown; positive and negative points are', () => {
    const view = leadOf(
      lead([
        { fact: 'Bakes bread on site daily', points: 20, source },
        { fact: 'Website summary: a neighbourhood bakery', points: 0, source },
        { fact: 'Part of a chain', points: -10, source },
      ]),
    );
    expect(view.evidence.map((e) => [e.fact, e.points])).toEqual([
      ['Bakes bread on site daily', 20],
      ['Part of a chain', -10],
    ]);
  });
});
