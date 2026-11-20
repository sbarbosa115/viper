import { flow as flowContract, flowListItem, type FlowInput } from '@app/contracts/research';
import { describe, expect, test } from 'vitest';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { ResearchFlowDefaults, ResearchPlanActivity, ResearchRunStats } from './flows.js';
import { owner, PLAN, researchFixture, staff, STAFF_ID } from '../test/research-fixture.js';
import { ResearchRun } from '../domain/run.js';
import { LOCAL_BUYERS_V1 } from '../domain/local-buyers.js';
import { bakeriesPlan } from '../test/research-fixture.js';

function input(overrides: Partial<FlowInput> = {}): FlowInput {
  const { version: _v, ...rest } = LOCAL_BUYERS_V1;
  return structuredClone({
    ...rest,
    steps: rest.steps.map((s) => ({ ...s, tools: [...s.tools] })),
    runSettings: {
      ...rest.runSettings,
      retryWaitsMinutes: [...rest.runSettings.retryWaitsMinutes],
    },
    ...overrides,
  });
}

async function fieldsOf(p: Promise<unknown>): Promise<Record<string, unknown>> {
  const error = await p.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).details ?? {};
}

describe('FR-37: Research flow settings', () => {
  test('lists and reads the "Local buyers" flow with the seeded settings and the ceilings', async () => {
    const f = await researchFixture();
    const list = await f.flows.list(staff());
    expect(list.items.map((i) => flowListItem.parse(i))).toEqual([
      expect.objectContaining({
        key: 'local-buyers',
        name: 'Local buyers',
        version: 1,
        isDefault: true,
        plansUsing: 0,
      }),
    ]);
    const flow = flowContract.parse(await f.flows.get(staff(), 'local-buyers'));
    expect(flow.runSettings).toEqual({
      maxActiveMinutes: 60,
      maxTotalHours: 3,
      maxAttempts: 3,
      retryWaitsMinutes: [1, 5, 15],
      workerStoppedAfterMinutes: 2,
      scoreAtBudgetPct: 80,
      scoreAtMinutes: 45,
    });
    expect(flow.steps.map((s) => s.budgetPct)).toEqual([2, 30, 0, 5, 20, 13, 10, 8, 12, 0]);
    expect(flow.ceilings.maxTotalHours).toBe(4);
    await expect(f.flows.get(staff(), 'unknown')).rejects.toBeInstanceOf(NotFoundError);
    await expect(f.flows.list(owner())).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('saving creates a new version with an Audit log entry naming the changed fields', async () => {
    const f = await researchFixture();
    const next = input({ runSettings: { ...input().runSettings, maxAttempts: 4 } });
    next.steps[1] = { ...next.steps[1]!, budgetPct: 25 };
    next.steps[4] = { ...next.steps[4]!, budgetPct: 25 };
    const saved = await f.flows.update(staff(), 'local-buyers', next);
    expect(saved).toMatchObject({ version: 2, runSettings: { maxAttempts: 4 } });
    expect(f.audit.entries).toEqual([
      expect.objectContaining({
        action: 'research_flow.updated',
        staffMemberId: STAFF_ID,
        targetId: 'local-buyers',
        details: {
          version: 2,
          fields: [
            'runSettings.maxAttempts',
            'steps.maps-places.budgetPct',
            'steps.websites.budgetPct',
          ],
        },
      }),
    ]);
    expect((await f.flows.get(staff(), 'local-buyers')).version).toBe(2);
  });

  test('max total time 5 h over a 4 h ceiling: 400 naming runSettings.maxTotalHours with the ceiling', async () => {
    const f = await researchFixture();
    const fields = await fieldsOf(
      f.flows.update(
        staff(),
        'local-buyers',
        input({ runSettings: { ...input().runSettings, maxTotalHours: 5 } }),
      ),
    );
    expect(fields).toEqual({ 'runSettings.maxTotalHours': 'Ceiling 4 h (Settings)' });
  });

  test('every value is checked against the platform ceilings', async () => {
    const f = await researchFixture();
    const fields = await fieldsOf(
      f.flows.update(
        staff(),
        'local-buyers',
        input({
          runSettings: {
            ...input().runSettings,
            maxActiveMinutes: 150,
            maxAttempts: 6,
            scoreAtMinutes: 45,
          },
          planDefaults: { maxCredits: 2000, maxLeads: 600, minFitScore: 60 },
        }),
      ),
    );
    expect(fields).toMatchObject({
      'runSettings.maxActiveMinutes': 'Ceiling 120 min (Settings)',
      'runSettings.maxAttempts': 'Ceiling 5 (Settings)',
      'planDefaults.maxCredits': 'Ceiling 1000 credits (Settings)',
      'planDefaults.maxLeads': 'Ceiling 500 leads (Settings)',
    });
  });

  test('budget shares adding up to 95%: "Step budget shares must add up to 100%"', async () => {
    const f = await researchFixture();
    const next = input();
    next.steps[1] = { ...next.steps[1]!, budgetPct: 25 };
    const error = await f.flows.update(staff(), 'local-buyers', next).catch((e: unknown) => e);
    expect((error as ValidationError).message).toBe('Step budget shares must add up to 100%');
  });

  test('Steps 2, 8 and 9 are always required', async () => {
    const f = await researchFixture();
    const next = input();
    next.steps[7] = { ...next.steps[7]!, required: false };
    expect(await fieldsOf(f.flows.update(staff(), 'local-buyers', next))).toEqual({
      'steps.7.required': 'Verify is always required',
    });
  });

  test('a run in progress on v1 keeps v1’s limits when Staff save v2; new runs use v2', async () => {
    const f = await researchFixture();
    const running = await f.runs.start(owner(), PLAN);
    await f.flows.update(
      staff(),
      'local-buyers',
      input({ runSettings: { ...input().runSettings, maxAttempts: 2 } }),
    );
    expect(await f.runs.get(owner(), running.id)).toMatchObject({
      flow: { version: 1 },
      attempt: { max: 3 },
    });
    await f.runToEnd(running.id);
    expect(f.store.run(running.id)?.toSnapshot().flow.runSettings.maxAttempts).toBe(3);
    const next = await f.runs.start(owner(), PLAN);
    expect(next).toMatchObject({ flow: { version: 2 }, attempt: { max: 2 } });
    expect((await f.flows.list(staff())).items[0]?.plansUsing).toBe(1);
  });
});

describe('planning ports: FlowDefaults, RunStats, PlanActivity', () => {
  test('plan defaults and limits come from the current flow version within the ceilings', async () => {
    const f = await researchFixture();
    const defaults = new ResearchFlowDefaults({ store: f.store, settings: f.settings });
    expect(await defaults.planDefaults('local-buyers')).toEqual({
      maxCredits: 400,
      maxLeads: 100,
      minFitScore: 60,
    });
    expect(await defaults.ceilings('local-buyers')).toEqual({ maxCredits: 1000, maxLeads: 500 });
    f.settings.ceilingValues = { ...f.settings.ceilingValues, maxCredits: 300 };
    expect((await defaults.planDefaults('local-buyers')).maxCredits).toBe(300);
  });

  test('typical credits: null with fewer than 5 completed runs with Leads, else the median of the last 20', async () => {
    const f = await researchFixture();
    const stats = new ResearchRunStats(f.store);
    const flow = (await f.store.transaction((tx) => tx.flows.latest('local-buyers')))!;
    const addRun = async (credits: number, leads: number, n: number) => {
      const run = ResearchRun.queue({
        id: `00000000-0000-7000-8000-0000000a${n.toString(16).padStart(4, '0')}`,
        flowId: flow.id,
        flow,
        plan: bakeriesPlan(),
        promptVersion: 'v',
        startedByMemberId: 'm',
        startedByStaffId: null,
        now: new Date(Date.UTC(2026, 10, 1, 0, n)),
      });
      run.beginAttempt(new Date(Date.UTC(2026, 10, 1, 0, n)));
      run.setLeadsDelivered(leads);
      run.complete(new Date(Date.UTC(2026, 10, 1, 1, n)), credits);
      await f.store.transaction((tx) => tx.runs.insert(run));
    };
    for (const [i, c] of [100, 120, 140, 160].entries()) await addRun(c, 5, i);
    await addRun(999, 0, 10);
    expect(await stats.typicalCredits('local-buyers')).toBeNull();
    await addRun(200, 5, 11);
    expect(await stats.typicalCredits('local-buyers')).toBe(140);
  });

  test('last runs per Plan', async () => {
    const f = await researchFixture();
    const run = await f.runs.start(owner(), PLAN);
    const activity = new ResearchPlanActivity(f.store);
    const last = await activity.lastRuns(owner().businessId, [
      PLAN,
      '00000000-0000-7000-8000-00000000e00f',
    ]);
    expect([...last.keys()]).toEqual([PLAN]);
    expect(last.get(PLAN)?.id).toBe(run.id);
    expect((await activity.lastRuns(owner().businessId, [])).size).toBe(0);
  });
});
