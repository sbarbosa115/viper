import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import type { ResearchStore, StepRecord } from '../application/ports.js';
import { PROMPT_VERSION } from '../application/prompts/v1.js';
import { LOCAL_BUYERS_KEY } from '../domain/local-buyers.js';
import { ResearchRun, type PlanSnapshot } from '../domain/run.js';

/** Fixed ids the seed shares across modules (scripts/seed.ts `demo`). */
export interface ResearchDemoIds {
  businesses: { sweetSupply: string };
  members: { owner: string };
  products: { caneSugar: string };
  plans: { bakeriesNearAustin: string };
  runs: { bakeriesNearAustin: string };
}

const DEMO_MILLICREDITS = 136_200;
const DEMO_LEADS = 25;
const DEMO_MINUTES = 28;

function demoPlan(demo: ResearchDemoIds, ids: IdGenerator): PlanSnapshot {
  const product = { productId: demo.products.caneSugar, productName: 'Cane sugar, 50 lb bag' };
  return {
    id: demo.plans.bakeriesNearAustin,
    businessId: demo.businesses.sweetSupply,
    flowKey: LOCAL_BUYERS_KEY,
    name: 'Bakeries near Austin',
    goal: 'Bakeries within 3 miles that could buy our cane sugar',
    segments: [
      {
        id: ids.next(),
        name: 'Bakeries',
        fitSignals: ['Bakes on site', 'Sells bread or pastries daily', 'Independent, not a chain'],
        exclusions: ['Chain bakeries', 'Grocery store bakeries'],
        ...product,
      },
      {
        id: ids.next(),
        name: 'Cafés that bake',
        fitSignals: ['Bakes pastries in house', 'Has a dessert or pastry case'],
        exclusions: ['Chain coffee shops'],
        ...product,
      },
      {
        id: ids.next(),
        name: 'Dessert shops',
        fitSignals: ['Makes desserts on site', 'Sells cakes, cookies or doughnuts'],
        exclusions: ['Frozen yogurt chains', 'Ice cream franchises'],
        ...product,
      },
    ],
    searchArea: {
      label: '1200 E 6th St, Austin, TX 78702',
      lat: 30.2624,
      lng: -97.7262,
      radiusMiles: 3,
    },
    guardrails: { maxCredits: 400, maxLeads: 100, minFitScore: 60 },
    icpEdited: false,
  };
}

const FAILED_STEP_KEY = 'websites';
const FAILED_ERROR = 'The website reader provider was unavailable (503) after 3 tries.';

/**
 * A failed run of "Bakeries near Austin" for the support demo: it stopped in the Websites step
 * (step 5 of "Local buyers"), 0 Leads, so the failure policy waived its spend (0 credits charged).
 * Started two days before the seed. Found by "the most recent failed run of that Plan". No
 * outbox event (no email) and no Reservation: it is history only. Idempotent.
 */
export async function seedFailedRun(deps: {
  store: ResearchStore;
  clock: Clock;
  ids: IdGenerator;
  demo: ResearchDemoIds;
}): Promise<void> {
  const { store, ids, demo } = deps;
  const started = new Date(deps.clock.now().getTime() - 2 * 24 * 3600 * 1000);
  const failed = new Date(started.getTime() + 9 * 60_000);
  await store.transaction(async (tx) => {
    const existing = await tx.runs.listForPlan(
      demo.businesses.sweetSupply,
      demo.plans.bakeriesNearAustin,
      {
        limit: 50,
      },
    );
    if (existing.some((r) => r.toSnapshot().status === 'failed')) return;
    const flow = await tx.flows.latest(LOCAL_BUYERS_KEY);
    if (!flow) throw new Error('Seed the "Local buyers" flow first');
    const run = ResearchRun.queue({
      id: ids.next(),
      flowId: flow.id,
      flow: {
        key: flow.key,
        name: flow.name,
        version: flow.version,
        runSettings: flow.runSettings,
        planDefaults: flow.planDefaults,
        steps: flow.steps,
      },
      plan: demoPlan(demo, ids),
      promptVersion: PROMPT_VERSION,
      startedByMemberId: demo.members.owner,
      startedByStaffId: null,
      now: started,
    });
    run.beginAttempt(started);
    run.addSpend(20_000, 8_000);
    run.addActiveSeconds(9 * 60);
    run.waiveSpend();
    run.fail('PROVIDER_ERROR', failed, 0);
    await tx.runs.insert(run);

    const failedAt = flow.steps.findIndex((d) => d.key === FAILED_STEP_KEY);
    const steps: StepRecord[] = flow.steps.map((def, position) => ({
      id: ids.next(),
      runId: run.id,
      key: def.key,
      position,
      status: position < failedAt ? 'done' : position === failedAt ? 'failed' : 'pending',
      attempts: position <= failedAt ? 1 : 0,
      progress: null,
      startedAt: position <= failedAt ? new Date(started.getTime() + position * 60_000) : null,
      finishedAt:
        position <= failedAt ? new Date(started.getTime() + (position + 1) * 60_000) : null,
      millicreditsSpent: position < failedAt ? Math.round(20_000 / failedAt) : 0,
      checkpoint: null,
      error: position === failedAt ? FAILED_ERROR : null,
    }));
    await tx.steps.insertMany(steps);
    await tx.attempts.insert({
      id: ids.next(),
      runId: run.id,
      n: 1,
      status: 'final_error',
      fromStep: flow.steps[0]?.key ?? FAILED_STEP_KEY,
      fromItem: 0,
      reachedStep: FAILED_STEP_KEY,
      reachedItem: 0,
      error: FAILED_ERROR,
      handoff: null,
      leaseOwner: 'seed',
      leaseExpiresAt: null,
      startedAt: started,
      endedAt: failed,
      activeSeconds: 9 * 60,
    });
  });
}

/**
 * The completed demo run of "Bakeries near Austin" (PRD section 8a): 25 Leads, 136,200
 * millicredits = 137 credits (billing seeds the matching Reservation and Settlement). No outbox
 * event, so no email. Idempotent.
 */
export async function seedDemoRun(deps: {
  store: ResearchStore;
  clock: Clock;
  ids: IdGenerator;
  demo: ResearchDemoIds;
}): Promise<void> {
  const { store, ids, demo } = deps;
  const finished = new Date(deps.clock.now().getTime() - 24 * 3600 * 1000);
  const started = new Date(finished.getTime() - DEMO_MINUTES * 60_000);
  await store.transaction(async (tx) => {
    if (await tx.runs.find(demo.runs.bakeriesNearAustin)) return;
    const flow = await tx.flows.latest(LOCAL_BUYERS_KEY);
    if (!flow) throw new Error('Seed the "Local buyers" flow first');
    const run = ResearchRun.queue({
      id: demo.runs.bakeriesNearAustin,
      flowId: flow.id,
      flow: {
        key: flow.key,
        name: flow.name,
        version: flow.version,
        runSettings: flow.runSettings,
        planDefaults: flow.planDefaults,
        steps: flow.steps,
      },
      plan: demoPlan(demo, ids),
      promptVersion: PROMPT_VERSION,
      startedByMemberId: demo.members.owner,
      startedByStaffId: null,
      now: started,
    });
    run.beginAttempt(started);
    run.addSpend(DEMO_MILLICREDITS, 54_480);
    run.setLeadsDelivered(DEMO_LEADS);
    run.addActiveSeconds(DEMO_MINUTES * 60);
    run.complete(finished, 137);
    await tx.runs.insert(run);

    const stepMinutes = DEMO_MINUTES / flow.steps.length;
    const steps: StepRecord[] = flow.steps.map((def, position) => ({
      id: ids.next(),
      runId: run.id,
      key: def.key,
      position,
      status: 'done',
      attempts: 1,
      progress: {
        done: [],
        total: 0,
        okCalls: 0,
        failedCalls: 0,
        activeSeconds: Math.round(stepMinutes * 60),
        stoppedBy: null,
        data: {},
      },
      startedAt: new Date(started.getTime() + position * stepMinutes * 60_000),
      finishedAt: new Date(started.getTime() + (position + 1) * stepMinutes * 60_000),
      millicreditsSpent: Math.round((DEMO_MILLICREDITS * def.budgetPct) / 100),
      checkpoint: def.key === 'deliver' ? { delivered: DEMO_LEADS } : {},
      error: null,
    }));
    await tx.steps.insertMany(steps);
    const handoff = {
      stepKey: 'deliver',
      itemsDone: 0,
      itemsLeft: 0,
      notes: 'Most bakeries list a contact email on their website.',
      lastError: null,
      creditsLeft: 400 - 137,
      activeSecondsLeft: (flow.runSettings.maxActiveMinutes - DEMO_MINUTES) * 60,
    };
    await tx.attempts.insert({
      id: ids.next(),
      runId: run.id,
      n: 1,
      status: 'completed',
      fromStep: 'search-terms',
      fromItem: 0,
      reachedStep: 'deliver',
      reachedItem: 0,
      error: null,
      handoff,
      leaseOwner: 'seed',
      leaseExpiresAt: null,
      startedAt: started,
      endedAt: finished,
      activeSeconds: DEMO_MINUTES * 60,
    });
    await tx.handoffs.save({ ...handoff, runId: run.id, attemptN: 1, updatedAt: finished });
  });
}
