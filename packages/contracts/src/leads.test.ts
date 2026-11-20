import { describe, expect, test } from 'vitest';
import * as ex from './examples.js';
import { exportLeadsCsv, getLead, leadCsvColumns, listLeads, setLeadFeedback } from './leads.js';
import { listTools, updateTool } from './tools.js';

describe('contracts: leads', () => {
  test('FR-26: list query defaults (50, score) and filters', () => {
    const q = listLeads.query.parse({});
    expect(q).toMatchObject({ limit: 50, sort: 'score' });
    expect(listLeads.query.parse({ minScore: '70', feedback: 'none' })).toMatchObject({
      minScore: 70,
      feedback: 'none',
    });
    expect(listLeads.query.safeParse({ sort: 'name' }).success).toBe(false);
    const stats = {
      total: 25,
      avgFitScore: 74.2,
      verifiedPct: 90,
      creditsSpent: 137,
      costPerLead: 5.48,
    };
    expect(
      listLeads.response.safeParse({ items: [ex.leadSummary], nextCursor: null, stats }).success,
    ).toBe(true);
    expect(
      listLeads.response.safeParse({ items: [ex.leadSummary], nextCursor: null }).success,
    ).toBe(false);
  });

  test('FR-26: lead detail keeps a Source on every contact and Evidence item', () => {
    expect(getLead.response.parse(ex.lead)).toEqual(ex.lead);
    const noSource = { ...ex.lead, contacts: [{ ...ex.lead.contacts[0], source: undefined }] };
    expect(getLead.response.safeParse(noSource).success).toBe(false);
    const tooMany = { ...ex.lead, evidence: [{ ...ex.lead.evidence[0], points: 41 }] };
    expect(getLead.response.safeParse(tooMany).success).toBe(false);
  });

  test('FR-27: feedback can be set, given a reason, or cleared', () => {
    expect(setLeadFeedback.body.safeParse({ value: 'not_fit', reason: 'Closed' }).success).toBe(
      true,
    );
    expect(setLeadFeedback.body.safeParse({ value: null }).success).toBe(true);
    expect(setLeadFeedback.body.safeParse({ value: 'meh' }).success).toBe(false);
    expect(setLeadFeedback.body.safeParse({ value: 'good', reason: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });

  test('FR-28: CSV export uses the list filters and declares text/csv', () => {
    expect(exportLeadsCsv.contentType).toBe('text/csv');
    expect(exportLeadsCsv.query.parse({ feedback: 'good' })).toEqual({
      feedback: 'good',
      sort: 'score',
    });
    expect(exportLeadsCsv.query.safeParse({ minScore: '101' }).success).toBe(false);
    expect(leadCsvColumns[0]).toBe('business_name');
    expect(leadCsvColumns).toHaveLength(18);
  });
});

describe('contracts: tools', () => {
  test('FR-23: tool list', () => {
    expect(listTools.response.safeParse({ items: [ex.tool] }).success).toBe(true);
    expect(listTools.response.safeParse({ items: [{ ...ex.tool, enabled: 'yes' }] }).success).toBe(
      false,
    );
  });

  test('FR-23: tool edit bounds', () => {
    expect(updateTool.body.safeParse({ enabled: false }).success).toBe(true);
    expect(updateTool.body.safeParse({ creditsPerUnit: 1.5 }).success).toBe(true);
    expect(updateTool.body.safeParse({ creditsPerUnit: 0 }).success).toBe(false);
    expect(updateTool.body.safeParse({ providerCostMicrosPerUnit: 100_000_001 }).success).toBe(
      false,
    );
    expect(updateTool.body.safeParse({}).success).toBe(false);
    expect(updateTool.params.safeParse({ key: 'google.places' }).success).toBe(true);
    expect(updateTool.params.safeParse({ key: 'Google Places' }).success).toBe(false);
  });
});
