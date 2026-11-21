import type { Tool as ToolDto, UpdateToolBody } from '@app/contracts/tools';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../../shared/domain/errors.js';
import { toolDefinition } from '../domain/catalog.js';
import { NO_STATS, toolHealth, type ToolStats } from '../domain/health.js';
import { Tool, type ToolSnapshot } from '../domain/tool.js';
import type { ProviderRequirement } from '../domain/tool-keys.js';
import {
  isConfigured,
  type ProviderSettings,
  type ToolCallRepository,
  type ToolRepository,
  type ToolSpend,
} from './ports.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const STARTED_WITHOUT_RESULT = 'No result stored: the worker stopped during this call';

/**
 * platform's AuditRecorder (FR-7). `within` is the open transaction of the change being audited,
 * so the change and its entry commit together.
 */
export interface ToolAudit {
  record(
    entry: {
      staffMemberId: string;
      businessId: string | null;
      action: string;
      targetType: string;
      targetId: string | null;
      details?: Readonly<Record<string, unknown>>;
    },
    within?: object,
  ): Promise<void>;
}

/** Runs `fn` in one database transaction: the Tools on it, and its handle for the Audit log. */
export type ToolCatalogTransaction = <T>(
  fn: (scope: { tools: ToolRepository; within: object | undefined }) => Promise<T>,
) => Promise<T>;

function requireStaff(actor: Actor | null): Actor {
  if (!actor) throw new UnauthenticatedError('Sign in required');
  if (!actor.roles.includes('staff')) throw new ForbiddenError('Staff only');
  return actor;
}

function requirementOf(key: string): ProviderRequirement {
  return toolDefinition(key)?.requires ?? null;
}

interface CatalogDeps {
  tools: ToolRepository;
  calls: ToolCallRepository;
  settings: ProviderSettings;
  clock: Clock;
}

async function configuredMap(
  keys: readonly string[],
  settings: ProviderSettings,
): Promise<Map<string, boolean>> {
  const requirements = [...new Set(keys.map(requirementOf))];
  const answers = await Promise.all(requirements.map((r) => isConfigured(r, settings)));
  const byRequirement = new Map(requirements.map((r, i) => [r, answers[i] ?? false]));
  return new Map(keys.map((k) => [k, byRequirement.get(requirementOf(k)) ?? false]));
}

function toDto(snapshot: ToolSnapshot, configured: boolean, stats: ToolStats): ToolDto {
  const tool = Tool.restore(snapshot);
  const health = toolHealth(stats);
  return {
    key: tool.key,
    name: tool.name,
    provider: tool.provider,
    unit: tool.unit,
    providerCostMicrosPerUnit: tool.rateCard.providerCostMicrosPerUnit,
    creditsPerUnit: tool.rateCard.creditsPerUnit,
    marginPct: tool.rateCard.marginPct(),
    enabled: tool.enabled,
    configured,
    health: {
      calls24h: health.calls24h,
      errorRate24h: health.errorRate24h,
      lastErrorAt: health.lastErrorAt?.toISOString() ?? null,
      lastError: health.lastError,
    },
  };
}

/** GET /api/staff/tools (FR-23): every Tool with its Rate card, configured flag and health. */
export class ListTools {
  constructor(private readonly deps: CatalogDeps) {}

  async execute(query: { actor: Actor | null }): Promise<{ items: ToolDto[] }> {
    requireStaff(query.actor);
    const since = new Date(this.deps.clock.now().getTime() - DAY_MS);
    const [tools, stats] = await Promise.all([
      this.deps.tools.list(),
      this.deps.calls.statsSince(since),
    ]);
    const configured = await configuredMap(
      tools.map((t) => t.key),
      this.deps.settings,
    );
    return {
      items: tools.map((t) =>
        toDto(t, configured.get(t.key) ?? false, stats.get(t.key) ?? NO_STATS),
      ),
    };
  }
}

/** PATCH /api/staff/tools/:key (FR-23): enable/disable or reprice; Audit log `tool.updated`. */
export class UpdateTool {
  constructor(
    private readonly deps: CatalogDeps & {
      audit: ToolAudit;
      /** The Rate card change and its Audit log entry commit together (default: no transaction). */
      transaction?: ToolCatalogTransaction;
    },
  ) {}

  async execute(cmd: {
    actor: Actor | null;
    key: string;
    changes: UpdateToolBody;
  }): Promise<ToolDto> {
    const actor = requireStaff(cmd.actor);
    const transaction: ToolCatalogTransaction =
      this.deps.transaction ?? ((fn) => fn({ tools: this.deps.tools, within: undefined }));
    const tool = await transaction(async ({ tools, within }) => {
      const snapshot = await tools.find(cmd.key);
      if (!snapshot) throw new NotFoundError('Tool not found', { key: cmd.key });
      const found = Tool.restore(snapshot);
      const before = found.toSnapshot();
      const changed = found.change(cmd.changes, this.deps.clock.now());
      if (changed.length === 0) return found;
      const after = found.toSnapshot();
      await tools.save(after);
      await this.deps.audit.record(
        {
          staffMemberId: actor.memberId,
          businessId: null,
          action: 'tool.updated',
          targetType: 'tool',
          targetId: found.key,
          details: {
            fields: changed,
            ...Object.fromEntries(
              changed.map((f) => [
                f,
                {
                  from: before[f as keyof ToolSnapshot],
                  to: after[f as keyof ToolSnapshot],
                },
              ]),
            ),
          },
        },
        within,
      );
      return found;
    });
    const since = new Date(this.deps.clock.now().getTime() - DAY_MS);
    const [stats, configured] = await Promise.all([
      this.deps.calls.statsSince(since),
      configuredMap([tool.key], this.deps.settings),
    ]);
    return toDto(
      tool.toSnapshot(),
      configured.get(tool.key) ?? false,
      stats.get(tool.key) ?? NO_STATS,
    );
  }
}

/** What research asks before starting a run (FR-18: required Tools enabled and configured). */
export interface ToolAvailability {
  readonly key: string;
  readonly enabled: boolean;
  readonly configured: boolean;
}

/** tools' public read side for other modules. */
export class ToolQueries {
  constructor(private readonly deps: Pick<CatalogDeps, 'tools' | 'calls' | 'settings'>) {}

  async availability(keys: readonly string[]): Promise<ToolAvailability[]> {
    const tools = new Map((await this.deps.tools.list()).map((t) => [t.key, t]));
    const configured = await configuredMap(keys, this.deps.settings);
    return keys.map((key) => ({
      key,
      enabled: tools.get(key)?.enabled ?? false,
      configured: tools.has(key) && (configured.get(key) ?? false),
    }));
  }

  /** Provider cost, calls and errors per Tool for calls made in [from, to) (Staff dashboard, FR-30). */
  spendByTool(window: { from: Date; to: Date }): Promise<ToolSpend[]> {
    return this.deps.calls.spendBetween(window);
  }

  /**
   * Metered provider cost in the UTC month ('YYYY-MM') per provider, in micro-dollars: every
   * Tool call created in it, whatever its status; providers with no cost are left out.
   */
  async meteredCostByProvider(month: string): Promise<{ provider: string; micros: number }[]> {
    const { year, index } = parseMonth(month);
    const [costs, tools] = await Promise.all([
      this.deps.calls.costByToolBetween({
        from: new Date(Date.UTC(year, index, 1)),
        to: new Date(Date.UTC(year, index + 1, 1)),
      }),
      this.deps.tools.list(),
    ]);
    const providerOf = new Map(tools.map((t) => [t.key, t.provider]));
    const byProvider = new Map<string, number>();
    for (const c of costs) {
      const provider = providerOf.get(c.toolKey);
      if (provider) byProvider.set(provider, (byProvider.get(provider) ?? 0) + c.micros);
    }
    return [...byProvider]
      .filter(([, micros]) => micros > 0)
      .map(([provider, micros]) => ({ provider, micros }))
      .sort((a, b) => a.provider.localeCompare(b.provider));
  }

  /**
   * `meteredCostByProvider` for every UTC month from `fromMonth` to `toMonth` (inclusive) in one
   * grouped query and one Tools read; one item per provider and month with cost, omitting zeros.
   */
  async meteredCostByProviderMonths(
    fromMonth: string,
    toMonth: string,
  ): Promise<{ month: string; provider: string; micros: number }[]> {
    const first = parseMonth(fromMonth);
    const last = parseMonth(toMonth);
    if ((last.year - first.year) * 12 + (last.index - first.index) < 0) {
      throw new ValidationError('Invalid month range', { month: 'From must not be after to' });
    }
    const [costs, tools] = await Promise.all([
      this.deps.calls.costByToolMonthBetween({
        from: new Date(Date.UTC(first.year, first.index, 1)),
        to: new Date(Date.UTC(last.year, last.index + 1, 1)),
      }),
      this.deps.tools.list(),
    ]);
    const providerOf = new Map(tools.map((t) => [t.key, t.provider]));
    const sums = new Map<string, { month: string; provider: string; micros: number }>();
    for (const c of costs) {
      const provider = providerOf.get(c.toolKey);
      if (!provider) continue;
      const key = `${c.month}|${provider}`;
      const sum = sums.get(key) ?? { month: c.month, provider, micros: 0 };
      sums.set(key, { ...sum, micros: sum.micros + c.micros });
    }
    return [...sums.values()]
      .filter((s) => s.micros > 0)
      .sort((a, b) => a.month.localeCompare(b.month) || a.provider.localeCompare(b.provider));
  }

  /** Every provider with its Tool keys, sorted by provider name (finance's provider list). */
  async providers(): Promise<{ name: string; toolKeys: string[] }[]> {
    const byName = new Map<string, string[]>();
    for (const t of await this.deps.tools.list()) {
      byName.set(t.provider, [...(byName.get(t.provider) ?? []), t.key]);
    }
    return [...byName]
      .map(([name, toolKeys]) => ({ name, toolKeys: toolKeys.sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A run's Tool calls, oldest first (Staff run detail, FR-32/FR-36). */
  async callsForRun(runId: string): Promise<
    {
      id: string;
      stepKey: string | null;
      attempt: number | null;
      toolKey: string;
      units: number;
      millicredits: number;
      providerCostMicros: number;
      status: 'ok' | 'error' | 'skipped';
      error: string | null;
      durationMs: number;
      reused: boolean;
      createdAt: Date;
    }[]
  > {
    const calls = await this.deps.calls.listForRun(runId);
    return calls.map((c) => ({
      id: c.id,
      stepKey: c.stepKey,
      attempt: c.attemptN,
      toolKey: c.toolKey,
      units: c.units,
      millicredits: c.millicredits,
      providerCostMicros: c.providerCostMicros,
      // A call left `started` never got a result: its worker stopped mid-call.
      status: c.status === 'started' ? 'error' : c.status,
      error: c.status === 'started' ? STARTED_WITHOUT_RESULT : c.error,
      durationMs: c.durationMs,
      reused: c.reused,
      createdAt: c.createdAt,
    }));
  }
}

/** 'YYYY-MM' to a year and zero-based month index. */
function parseMonth(month: string): { year: number; index: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new ValidationError('Invalid month', { month: 'Use YYYY-MM' });
  return { year: Number(match[1]), index: Number(match[2]) - 1 };
}
