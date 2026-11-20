import type { Flow, FlowInput, FlowListItem, RunSummary } from '@app/contracts/research';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import {
  changedFlowFields,
  validateFlowSettings,
  type FlowCeilings,
  type FlowSettingsSnapshot,
  type FlowVersion,
} from '../domain/flow.js';
import { requireStaff } from './policies.js';
import type { AuditPort, PlatformSettingsPort, ResearchStore } from './ports.js';
import { toRunSummary } from './run-views.js';

export interface FlowUseCaseDeps {
  store: ResearchStore;
  settings: PlatformSettingsPort;
  audit: AuditPort;
  clock: Clock;
  ids: IdGenerator;
}

const flowNotFound = (key: string) => new NotFoundError('Research flow not found', { key });

async function flowCeilings(
  settings: PlatformSettingsPort,
): Promise<FlowCeilings & { trialCredits: number }> {
  return settings.ceilings();
}

/** Research flow settings for Staff (FR-37), versioned; runs keep the version they started on. */
export class FlowUseCases {
  constructor(private readonly deps: FlowUseCaseDeps) {}

  async list(actor: Actor): Promise<{ items: FlowListItem[]; nextCursor: null }> {
    requireStaff(actor);
    return this.deps.store.transaction(async (tx) => {
      const flows = await tx.flows.listLatest();
      const using = await tx.flows.plansUsing(flows.map((f) => f.key));
      return {
        items: flows.map((f) => ({
          key: f.key,
          name: f.name,
          version: f.version,
          isDefault: f.isDefault,
          plansUsing: using.get(f.key) ?? 0,
          updatedAt: f.createdAt.toISOString(),
        })),
        nextCursor: null,
      };
    });
  }

  async get(actor: Actor, key: string): Promise<Flow> {
    requireStaff(actor);
    const flow = await this.deps.store.transaction((tx) => tx.flows.latest(key));
    if (!flow) throw flowNotFound(key);
    return this.view(flow);
  }

  /** Saves a new version (400 naming the ceiling or the 100% rule) and records the Audit log. */
  async update(actor: Actor, key: string, input: FlowInput): Promise<Flow> {
    requireStaff(actor);
    const ceilings = await flowCeilings(this.deps.settings);
    const saved = await this.deps.store.transaction(async (tx) => {
      const current = await tx.flows.latest(key);
      if (!current) throw flowNotFound(key);
      const errors = validateFlowSettings(input, ceilings, current);
      if (Object.keys(errors).length > 0) {
        throw new ValidationError(Object.values(errors)[0] ?? 'Invalid flow settings', errors);
      }
      const next: FlowVersion = {
        ...current,
        id: this.deps.ids.next(),
        name: input.name,
        version: current.version + 1,
        runSettings: input.runSettings,
        planDefaults: input.planDefaults,
        steps: input.steps,
        createdBy: actor.memberId,
        createdAt: this.deps.clock.now(),
      };
      await tx.flows.insert(next);
      return { next, changed: changedFlowFields(current, input) };
    });
    await this.deps.audit.record({
      staffMemberId: actor.actingAs?.staffMemberId ?? actor.memberId,
      businessId: null,
      action: 'research_flow.updated',
      targetType: 'research_flow',
      targetId: key,
      details: { version: saved.next.version, fields: saved.changed },
    });
    return this.view(saved.next);
  }

  /** Seeds a Flow template's first version when the flow doesn't exist yet (idempotent). */
  async ensureTemplate(template: FlowSettingsSnapshot, isDefault: boolean): Promise<void> {
    await this.deps.store.transaction(async (tx) => {
      if (await tx.flows.latest(template.key)) return;
      await tx.flows.insert({
        ...template,
        id: this.deps.ids.next(),
        isDefault,
        isTemplate: true,
        createdBy: null,
        createdAt: this.deps.clock.now(),
      });
    });
  }

  private async view(flow: FlowVersion): Promise<Flow> {
    const ceilings = await this.deps.settings.ceilings();
    return {
      key: flow.key,
      name: flow.name,
      version: flow.version,
      runSettings: {
        ...flow.runSettings,
        retryWaitsMinutes: [...flow.runSettings.retryWaitsMinutes],
      },
      planDefaults: { ...flow.planDefaults },
      steps: flow.steps.map((s) => ({ ...s, tools: [...s.tools] })),
      ceilings,
    };
  }
}

/** What planning reads from research (FR-16, FR-17): the flow's plan defaults and limits. */
export class ResearchFlowDefaults {
  constructor(private readonly deps: Pick<FlowUseCaseDeps, 'store' | 'settings'>) {}

  async planDefaults(
    flowKey: string,
  ): Promise<{ maxCredits: number; maxLeads: number; minFitScore: number }> {
    const flow = await this.deps.store.transaction((tx) => tx.flows.latest(flowKey));
    if (!flow) throw flowNotFound(flowKey);
    const ceilings = await this.deps.settings.ceilings();
    return {
      maxCredits: Math.min(flow.planDefaults.maxCredits, ceilings.maxCredits),
      maxLeads: Math.min(flow.planDefaults.maxLeads, ceilings.maxLeads),
      minFitScore: flow.planDefaults.minFitScore,
    };
  }

  /** The current flow's limits within the Platform ceilings (max credits, max leads). */
  async ceilings(flowKey: string): Promise<{ maxCredits: number; maxLeads: number }> {
    const flow = await this.deps.store.transaction((tx) => tx.flows.latest(flowKey));
    if (!flow) throw flowNotFound(flowKey);
    const ceilings = await this.deps.settings.ceilings();
    return { maxCredits: ceilings.maxCredits, maxLeads: ceilings.maxLeads };
  }
}

const TYPICAL_WINDOW = 20;
const TYPICAL_MIN_RUNS = 5;

/** FR-17: median credits of the last 20 completed runs with ≥ 1 Lead; null when fewer than 5. */
export class ResearchRunStats {
  constructor(private readonly store: ResearchStore) {}

  async typicalCredits(flowKey: string): Promise<number | null> {
    const credits = await this.store.transaction((tx) =>
      tx.runs.recentCompletedCredits(flowKey, TYPICAL_WINDOW),
    );
    if (credits.length < TYPICAL_MIN_RUNS) return null;
    const sorted = [...credits].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1
        ? (sorted[mid] ?? 0)
        : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    return Math.round(median);
  }
}

/** planning's PlanActivity.lastRuns: the newest run of each Plan, batched. */
export class ResearchPlanActivity {
  constructor(private readonly store: ResearchStore) {}

  lastRuns(
    businessId: string,
    planIds: readonly string[],
  ): Promise<ReadonlyMap<string, RunSummary>> {
    if (planIds.length === 0) return Promise.resolve(new Map());
    return this.store.transaction(async (tx) => {
      const runs = await tx.runs.latestForPlans(businessId, planIds);
      const steps = await tx.steps.listForRuns(runs.map((r) => r.id));
      return new Map(
        runs.map((r) => [r.toSnapshot().planId, toRunSummary(r, steps.get(r.id) ?? [])]),
      );
    });
  }
}
