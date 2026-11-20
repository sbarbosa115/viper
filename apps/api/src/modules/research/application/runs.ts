import type { RunSummary, StaffRunDetail, StaffRunSummary } from '@app/contracts/research';
import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { CodedError, NotFoundError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { claudeTool, isClaudeTool, type FlowVersion } from '../domain/flow.js';
import { DETERMINISTIC_STEPS } from '../domain/local-buyers.js';
import { ResearchRun, type PlanSnapshot } from '../domain/run.js';
import {
  assertOwner,
  assertVerified,
  decodeRunCursor,
  encodeRunCursor,
  requireStaff,
  runInProgress,
  runNotFound,
} from './policies.js';
import type {
  AuditPort,
  BillingPort,
  IdentityPort,
  PlanSnapshotsPort,
  ProductNamesPort,
  QueueMonitor,
  ResearchStore,
  ResearchTx,
  StaffRunFilter,
  StepRecord,
  ToolCallLogPort,
  ToolCatalogPort,
} from './ports.js';
import { PROMPT_VERSION } from './prompts/v1.js';
import { finishRun, markOpenSteps, trackRunFinished } from './run-lifecycle.js';
import { toRunSummary, toStaffRunDetail, toStaffRunSummary } from './run-views.js';

export interface RunUseCaseDeps {
  store: ResearchStore;
  billing: BillingPort;
  plans: PlanSnapshotsPort;
  catalog: ToolCatalogPort;
  identity: IdentityPort;
  toolCalls: ToolCallLogPort;
  monitor: QueueMonitor;
  audit: AuditPort;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  products?: ProductNamesPort;
}

const unavailable = () =>
  new CodedError(
    'RESEARCH_UNAVAILABLE',
    'Research is unavailable right now. Please try again later.',
  );

/** The Tools each Step needs: its provider Tools, and its Claude Tool unless it runs as code. */
function stepNeeds(step: FlowVersion['steps'][number]): {
  providers: string[];
  claude: string | null;
} {
  const providers = step.tools.filter((t) => !isClaudeTool(t));
  if (DETERMINISTIC_STEPS.includes(step.key)) return { providers, claude: null };
  return { providers, claude: step.tools.find(isClaudeTool) ?? claudeTool('planning') };
}

/** Each required Step needs its Claude Tool and at least one of its provider Tools (FR-18). */
async function assertToolsReady(catalog: ToolCatalogPort, flow: FlowVersion): Promise<void> {
  const required = flow.steps.filter((s) => s.required).map(stepNeeds);
  const keys = [
    ...new Set(required.flatMap((n) => [...n.providers, ...(n.claude ? [n.claude] : [])])),
  ];
  if (keys.length === 0) return;
  const availability = await catalog.availability(keys);
  for (const need of required) {
    if (need.claude && availability.get(need.claude) !== true) throw unavailable();
    if (need.providers.length > 0 && !need.providers.some((t) => availability.get(t) === true)) {
      throw unavailable();
    }
  }
}

function pendingSteps(run: ResearchRun, ids: IdGenerator): StepRecord[] {
  return run.toSnapshot().flow.steps.map((def, position) => ({
    id: ids.next(),
    runId: run.id,
    key: def.key,
    position,
    status: 'pending',
    attempts: 0,
    progress: null,
    startedAt: null,
    finishedAt: null,
    millicreditsSpent: 0,
    checkpoint: null,
    error: null,
  }));
}

/** Runs: start (FR-18), cancel (FR-21), resume (FR-21, FR-32, FR-36) and reads. */
export class RunUseCases {
  constructor(private readonly deps: RunUseCaseDeps) {}

  /** FR-18: run `queued`, Reservation of max credits and `RunRequested`, in one transaction. */
  async start(actor: Actor, planId: string): Promise<RunSummary> {
    assertOwner(actor);
    assertVerified(actor);
    const { store, clock, ids } = this.deps;
    const plan = await this.deps.plans.getPlanSnapshot(actor.businessId, planId);
    if (!plan) throw new NotFoundError('Plan not found', { planId });
    const { active, flow } = await store.transaction(async (tx) => ({
      active: await tx.runs.hasActive(actor.businessId),
      flow: await tx.flows.latest(plan.flowKey),
    }));
    if (active) throw runInProgress();
    if (!flow) throw unavailable();
    await assertToolsReady(this.deps.catalog, flow);

    const names = (await this.deps.products?.names(actor.businessId)) ?? new Map<string, string>();
    const snapshot: PlanSnapshot = {
      ...plan,
      segments: plan.segments.map((s) => ({ ...s, productName: names.get(s.productId) ?? null })),
    };
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
      plan: snapshot,
      promptVersion: PROMPT_VERSION,
      startedByMemberId: actor.memberId,
      startedByStaffId: actor.actingAs?.staffMemberId ?? null,
      now: clock.now(),
    });
    const steps = pendingSteps(run, ids);
    await store.transaction(async (tx) => {
      await this.deps.billing.reserve(
        { businessId: actor.businessId, runId: run.id, credits: plan.guardrails.maxCredits },
        tx.handle,
      );
      // Checked again under billing's wallet lock, so two starts can't both pass.
      if (await tx.runs.hasActive(actor.businessId)) throw runInProgress();
      await tx.runs.insert(run);
      await tx.steps.insertMany(steps);
      await tx.outbox.add('RunRequested', { runId: run.id, businessId: run.businessId });
    });
    await this.deps.analytics.track({
      name: 'run_started',
      actor,
      properties: {
        business_id: actor.businessId,
        plan_id: plan.id,
        run_id: run.id,
        credits_reserved: plan.guardrails.maxCredits,
        started_by_staff: actor.actingAs !== undefined,
      },
    });
    return toRunSummary(run, steps);
  }

  /** FR-21: a queued or retrying run stops now; a running one after its current Tool call. */
  async cancel(actor: Actor, runId: string): Promise<RunSummary> {
    assertOwner(actor);
    const now = this.deps.clock.now();
    const { run, steps, finished } = await this.deps.store.transaction(async (tx) => {
      const found = await tx.runs.findForUpdate(runId);
      if (found?.businessId !== actor.businessId) throw runNotFound(runId);
      if (!found.isActive) throw new CodedError('RUN_NOT_ACTIVE', 'This run is not running');
      const { immediate } = found.requestCancel(now);
      if (immediate) {
        await finishRun(tx, this.deps.billing, found, 'cancelled', null, now);
      }
      await tx.runs.save(found);
      return { run: found, steps: await tx.steps.list(runId), finished: immediate };
    });
    if (finished) await trackRunFinished(this.deps.analytics, run);
    return toRunSummary(run, steps);
  }

  /** FR-21 "Try again" (the Owner). */
  async resume(actor: Actor, runId: string): Promise<RunSummary> {
    assertOwner(actor);
    assertVerified(actor);
    return this.resumeRun(runId, (run) => run.businessId === actor.businessId);
  }

  /** FR-32 "Resume" (Staff): same run id, a new attempt from the last handoff; Audit log. */
  async resumeAsStaff(actor: Actor, runId: string): Promise<RunSummary> {
    requireStaff(actor);
    const summary = await this.resumeRun(runId, () => true);
    const run = await this.find(runId);
    await this.deps.audit.record({
      staffMemberId: actor.actingAs?.staffMemberId ?? actor.memberId,
      businessId: run?.businessId ?? null,
      action: 'run.resumed',
      targetType: 'run',
      targetId: runId,
      details: { fromStatus: 'failed' },
    });
    return summary;
  }

  private async resumeRun(
    runId: string,
    visible: (run: ResearchRun) => boolean,
  ): Promise<RunSummary> {
    const now = this.deps.clock.now();
    const { run, steps } = await this.deps.store.transaction(async (tx) => {
      const found = await tx.runs.findForUpdate(runId);
      if (!found || !visible(found)) throw runNotFound(runId);
      if (found.status !== 'failed')
        throw new CodedError('RUN_NOT_FAILED', 'Only a failed run can be resumed');
      if (await tx.runs.hasActive(found.businessId)) throw runInProgress();
      await this.deps.billing.topUpReservation(
        { runId, credits: found.resumeHoldCredits },
        tx.handle,
      );
      found.resume(now);
      await markOpenSteps(tx, runId, 'pending', null);
      await tx.runs.save(found);
      await tx.outbox.add('RunRequested', { runId, businessId: found.businessId });
      return { run: found, steps: await tx.steps.list(runId) };
    });
    return toRunSummary(run, steps);
  }

  async get(actor: Actor, runId: string): Promise<RunSummary> {
    assertOwner(actor);
    const run = await this.find(runId);
    if (run?.businessId !== actor.businessId) throw runNotFound(runId);
    const steps = await this.deps.store.transaction((tx) => tx.steps.list(runId));
    return toRunSummary(run, steps);
  }

  /** Newest first. 404 when the Plan isn't the Actor's Business's. */
  async listForPlan(
    actor: Actor,
    planId: string,
    query: { cursor?: string; limit: number },
  ): Promise<{ items: RunSummary[]; nextCursor: string | null }> {
    assertOwner(actor);
    const plan = await this.deps.plans.getPlanSnapshot(actor.businessId, planId);
    if (!plan) throw new NotFoundError('Plan not found', { planId });
    const after = decodeRunCursor(query.cursor);
    return this.deps.store.transaction(async (tx) => {
      const runs = await tx.runs.listForPlan(actor.businessId, planId, {
        after,
        limit: query.limit + 1,
      });
      const page = runs.slice(0, query.limit);
      const steps = await tx.steps.listForRuns(page.map((r) => r.id));
      return {
        items: page.map((r) => toRunSummary(r, steps.get(r.id) ?? [])),
        nextCursor: runs.length > query.limit ? this.cursorOf(page) : null,
      };
    });
  }

  async listForStaff(
    actor: Actor,
    query: StaffRunFilter & { cursor?: string; limit: number },
  ): Promise<{ items: StaffRunSummary[]; nextCursor: string | null }> {
    requireStaff(actor);
    const after = decodeRunCursor(query.cursor);
    const filter: StaffRunFilter = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.businessId ? { businessId: query.businessId } : {}),
    };
    const { page, steps, more } = await this.deps.store.transaction(async (tx) => {
      const runs = await tx.runs.listForStaff(filter, { after, limit: query.limit + 1 });
      const pageRuns = runs.slice(0, query.limit);
      return {
        page: pageRuns,
        steps: await tx.steps.listForRuns(pageRuns.map((r) => r.id)),
        more: runs.length > query.limit,
      };
    });
    const names = await this.businessNames(page.map((r) => r.businessId));
    const now = this.deps.clock.now();
    return {
      items: page.map((r) =>
        toStaffRunSummary(r, steps.get(r.id) ?? [], names.get(r.businessId) ?? '', now),
      ),
      nextCursor: more ? this.cursorOf(page) : null,
    };
  }

  async getForStaff(actor: Actor, runId: string): Promise<StaffRunDetail> {
    requireStaff(actor);
    const data = await this.deps.store.transaction(async (tx) => {
      const run = await tx.runs.find(runId);
      if (!run) throw runNotFound(runId);
      return {
        run,
        steps: await tx.steps.list(runId),
        attempts: await tx.attempts.list(runId),
        handoff: await tx.handoffs.get(runId),
      };
    });
    const [toolCalls, names] = await Promise.all([
      this.deps.toolCalls.listForRun(runId),
      this.businessNames([data.run.businessId]),
    ]);
    return toStaffRunDetail({
      ...data,
      toolCalls,
      businessName: names.get(data.run.businessId) ?? '',
      now: this.deps.clock.now(),
    });
  }

  /** FR-32 queue health. */
  async queueHealth(actor: Actor) {
    requireStaff(actor);
    const { monitor } = this.deps;
    const [counts, sweeper, workerLastSeenAt, retrying] = await Promise.all([
      monitor.counts(),
      monitor.sweeperStatus(),
      monitor.workerLastSeenAt(),
      this.deps.store.transaction((tx) => tx.runs.countByStatus('retrying')),
    ]);
    return {
      ...counts,
      retrying,
      stalledFound: sweeper.stalledFound,
      sweeperLastRunAt: sweeper.lastRunAt?.toISOString() ?? null,
      workerLastSeenAt: workerLastSeenAt?.toISOString() ?? null,
    };
  }

  private find(runId: string): Promise<ResearchRun | null> {
    return this.deps.store.transaction((tx: ResearchTx) => tx.runs.find(runId));
  }

  private cursorOf(page: readonly ResearchRun[]): string | null {
    const last = page[page.length - 1]?.toSnapshot();
    return last ? encodeRunCursor({ queuedAt: last.queuedAt, id: last.id }) : null;
  }

  private async businessNames(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const found = await this.deps.identity.getBusinesses(unique);
    return new Map(found.map((b) => [b.id, b.name]));
  }
}
