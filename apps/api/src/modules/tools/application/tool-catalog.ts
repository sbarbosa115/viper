import type { Tool as ToolDto, UpdateToolBody } from '@app/contracts/tools';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
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

/** platform's AuditRecorder (FR-7). */
export interface ToolAudit {
  record(entry: {
    staffMemberId: string;
    businessId: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    details?: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

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
  constructor(private readonly deps: CatalogDeps & { audit: ToolAudit }) {}

  async execute(cmd: {
    actor: Actor | null;
    key: string;
    changes: UpdateToolBody;
  }): Promise<ToolDto> {
    const actor = requireStaff(cmd.actor);
    const snapshot = await this.deps.tools.find(cmd.key);
    if (!snapshot) throw new NotFoundError('Tool not found', { key: cmd.key });
    const tool = Tool.restore(snapshot);
    const before = tool.toSnapshot();
    const changed = tool.change(cmd.changes, this.deps.clock.now());
    if (changed.length > 0) {
      const after = tool.toSnapshot();
      await this.deps.tools.save(after);
      await this.deps.audit.record({
        staffMemberId: actor.memberId,
        businessId: null,
        action: 'tool.updated',
        targetType: 'tool',
        targetId: tool.key,
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
      });
    }
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
      status: c.status,
      error: c.error,
      durationMs: c.durationMs,
      reused: c.reused,
      createdAt: c.createdAt,
    }));
  }
}
