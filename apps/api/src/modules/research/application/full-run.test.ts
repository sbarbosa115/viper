import { runSummary } from '@app/contracts/research';
import { describe, expect, test } from 'vitest';
import { LOCAL_BUYERS_V1, TOOL_KEYS } from '../domain/local-buyers.js';
import { BAKERIES } from '../test/bakery-fixtures.js';
import { BUSINESS, owner, PLAN, researchFixture } from '../test/research-fixture.js';

describe('FR-19: a full "Local buyers" run with fake Tools and the fake agent', () => {
  test('each Step records its Tool calls and a Checkpoint, and the run delivers the expected Leads', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    expect(started.status).toBe('queued');

    const results = await f.runToEnd(started.id);
    expect(results).toEqual(['completed']);

    const run = f.store.run(started.id)?.toSnapshot();
    expect(run?.status).toBe('completed');
    const steps = f.store.steps(started.id);
    expect(steps.map((s) => [s.key, s.status])).toEqual(
      LOCAL_BUYERS_V1.steps.map((s) => [s.key, 'done']),
    );
    for (const s of steps) expect(s.checkpoint).not.toBeNull();
    expect(steps.find((s) => s.key === 'search-terms')?.checkpoint?.terms).toHaveLength(7);
    expect(steps.find((s) => s.key === 'maps-places')?.checkpoint).toEqual({ prospectsFound: 30 });

    // Tool calls are recorded per Step.
    const stepsWithCalls = new Set(f.tools.calls.map((c) => c.stepKey));
    for (const key of ['maps-places', 'websites', 'socials-reviews', 'verify']) {
      expect(stepsWithCalls.has(key)).toBe(true);
    }

    // 30 bakeries, deduplicated; Leads qualify per FR-25 (fit ≥ 60, a verified contact), max 10.
    await expect(f.prospects.listProspects(started.id)).resolves.toHaveLength(30);
    const leads = f.prospects.leads.filter((l) => l.runId === started.id);
    expect(leads).toHaveLength(10);
    expect(run?.leadsDelivered).toBe(10);
    for (const lead of leads) expect(lead.fitScore).toBeGreaterThanOrEqual(60);

    // Settlement: real cost, rounded up once; the rest of the 400 released.
    const spent = Math.ceil((run?.millicreditsSpent ?? 0) / 1000);
    expect(run?.creditsSpent).toBe(spent);
    expect(await f.available()).toBe(1000 - spent);
    expect(f.store.outbox.map((e) => e.type)).toEqual(['RunRequested', 'RunCompleted']);

    const summary = runSummary.parse(await f.runs.get(owner(), started.id));
    expect(summary).toMatchObject({ status: 'completed', leadsDelivered: 10, takingLonger: false });
    expect(summary.costPerLead).toBe(Math.round((spent / 10) * 100) / 100);

    const finished = f.analytics.events.find((e) => e.name === 'run_finished');
    expect(finished?.properties).toMatchObject({
      run_id: started.id,
      status: 'completed',
      leads_delivered: 10,
    });
    expect(f.analytics.events.filter((e) => e.name === 'run_attempt_finished')).toHaveLength(1);
    expect(BAKERIES).toHaveLength(30);
    expect(f.tools.callsOf(TOOL_KEYS.firecrawl)).toBeGreaterThan(0);
    expect(BUSINESS).toBeTruthy();
  });
});
