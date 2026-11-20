import { describe, expect, test } from 'vitest';
import { InMemoryLeads } from '../infrastructure/in-memory-leads.js';
import { describeLeadsBehaviour } from '../test/leads-behaviour.js';
import { statsOf } from './lead-queries.js';

describeLeadsBehaviour('in memory', () => new InMemoryLeads());

describe('FR-26: stats strip rounding', () => {
  test('averages to 1 decimal, cost per lead to 2, null without data', () => {
    expect(
      statsOf({ total: 3, fitScoreSum: 250, phoneEmailContacts: 3, verifiedPhoneEmail: 2 }, 100),
    ).toEqual({
      total: 3,
      avgFitScore: 83.3,
      verifiedPct: 66.7,
      creditsSpent: 100,
      costPerLead: 33.33,
    });
    expect(
      statsOf({ total: 0, fitScoreSum: 0, phoneEmailContacts: 0, verifiedPhoneEmail: 0 }, 12),
    ).toEqual({
      total: 0,
      avgFitScore: null,
      verifiedPct: null,
      creditsSpent: 12,
      costPerLead: null,
    });
  });
});
