/** A Tool's last 24 h of calls (FR-23 Staff page). Skipped and reused calls are not counted. */
export interface ToolStats {
  readonly calls: number;
  readonly errors: number;
  readonly lastErrorAt: Date | null;
  readonly lastError: string | null;
}

export const NO_STATS: ToolStats = { calls: 0, errors: 0, lastErrorAt: null, lastError: null };

export interface ToolHealth {
  readonly calls24h: number;
  /** 0–100, 1 decimal; null with no calls. */
  readonly errorRate24h: number | null;
  readonly lastErrorAt: Date | null;
  readonly lastError: string | null;
}

export function toolHealth(stats: ToolStats): ToolHealth {
  return {
    calls24h: stats.calls,
    errorRate24h: stats.calls === 0 ? null : Math.round((stats.errors / stats.calls) * 1000) / 10,
    lastErrorAt: stats.lastErrorAt,
    lastError: stats.lastError,
  };
}
