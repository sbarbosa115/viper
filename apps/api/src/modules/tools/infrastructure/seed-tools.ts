import type { Database } from '../../../shared/infrastructure/db/database.js';
import type { ToolCallRecord, ToolRepository } from '../application/ports.js';
import { inputHash } from '../application/tool-runner.js';
import { TOOL_CATALOG, toolDefinition } from '../domain/catalog.js';
import { TOOL_KEYS, type ToolKey } from '../domain/tool-keys.js';
import { Tool } from '../domain/tool.js';
import { KyselyToolCallRepository } from './kysely-tool-repositories.js';

/**
 * Adds every Tool of the catalog with its seeded Rate card, enabled (PRD 8a, release notes:
 * production gets the Tools too). Tools already present keep Staff's prices and toggles, so the
 * seed is idempotent.
 */
export async function seedToolCatalog(tools: ToolRepository, now: Date): Promise<number> {
  const existing = new Set((await tools.list()).map((t) => t.key));
  let added = 0;
  for (const d of TOOL_CATALOG) {
    if (existing.has(d.key)) continue;
    const tool = Tool.define({
      key: d.key,
      name: d.name,
      provider: d.provider,
      unit: d.unit,
      creditsPerUnit: d.creditsPerUnit,
      providerCostMicrosPerUnit: d.providerCostMicrosPerUnit,
      enabled: true,
      maxUnitsPerCall: d.maxUnitsPerCall,
      updatedAt: now,
    });
    await tools.save(tool.toSnapshot());
    added += 1;
  }
  return added;
}

/**
 * prd-expenses section 8a: metered Tool calls in November 2026, outside any run, whose provider
 * cost per provider is Anthropic $38.40, Google Maps Platform $12.75, ZeroBounce $4.80, Twilio
 * $0.90, Apify $22.10 and Firecrawl $3.20. Units follow the seeded Rate card (Twilio's cost is as
 * billed). Fixed ids: rows already present are skipped, so the seed is idempotent.
 */
const DEMO_CALLS: readonly {
  n: number;
  toolKey: ToolKey;
  units: number;
  providerCostMicros: number;
  at: string;
}[] = [
  {
    n: 1,
    toolKey: TOOL_KEYS.claudePlanning,
    units: 2_400,
    providerCostMicros: 9_600_000,
    at: '2026-11-06T15:00:00.000Z',
  },
  {
    n: 2,
    toolKey: TOOL_KEYS.claudePlanningOut,
    units: 1_440,
    providerCostMicros: 28_800_000,
    at: '2026-11-06T15:00:01.000Z',
  },
  {
    n: 3,
    toolKey: TOOL_KEYS.googlePlaces,
    units: 300,
    providerCostMicros: 10_500_000,
    at: '2026-11-08T16:30:00.000Z',
  },
  {
    n: 4,
    toolKey: TOOL_KEYS.googleGeocoding,
    units: 450,
    providerCostMicros: 2_250_000,
    at: '2026-11-08T16:31:00.000Z',
  },
  {
    n: 5,
    toolKey: TOOL_KEYS.zerobounce,
    units: 600,
    providerCostMicros: 4_800_000,
    at: '2026-11-11T10:00:00.000Z',
  },
  {
    n: 6,
    toolKey: TOOL_KEYS.twilioLookup,
    units: 113,
    providerCostMicros: 900_000,
    at: '2026-11-11T10:05:00.000Z',
  },
  {
    n: 7,
    toolKey: TOOL_KEYS.apifyGoogleMaps,
    units: 5_000,
    providerCostMicros: 20_000_000,
    at: '2026-11-13T09:00:00.000Z',
  },
  {
    n: 8,
    toolKey: TOOL_KEYS.apifyYelp,
    units: 210,
    providerCostMicros: 2_100_000,
    at: '2026-11-13T09:10:00.000Z',
  },
  {
    n: 9,
    toolKey: TOOL_KEYS.firecrawl,
    units: 3_200,
    providerCostMicros: 3_200_000,
    at: '2026-11-14T12:00:00.000Z',
  },
];

const demoCallId = (n: number) =>
  `00000000-0000-7000-8000-${(0xc000 + n).toString(16).padStart(12, '0')}`;

export async function seedDemoToolCalls(db: Database, businessId: string): Promise<number> {
  const ids = DEMO_CALLS.map((c) => demoCallId(c.n));
  const existing = new Set(
    (await db.selectFrom('tool_calls').select('id').where('id', 'in', ids).execute()).map(
      (r) => r.id,
    ),
  );
  const records: ToolCallRecord[] = DEMO_CALLS.filter((c) => !existing.has(demoCallId(c.n))).map(
    (c) => {
      const input = { seed: 'finance-demo', n: c.n };
      const creditsPerUnit = toolDefinition(c.toolKey)?.creditsPerUnit ?? 0;
      return {
        id: demoCallId(c.n),
        runId: null,
        stepKey: null,
        attemptN: null,
        reused: false,
        businessId,
        toolKey: c.toolKey,
        inputHash: inputHash(input),
        input,
        output: null,
        units: c.units,
        millicredits: Math.round(c.units * creditsPerUnit * 1000),
        providerCostMicros: c.providerCostMicros,
        status: 'ok',
        error: null,
        durationMs: 800,
        createdAt: new Date(c.at),
      };
    },
  );
  await new KyselyToolCallRepository(db).add(records);
  return records.length;
}
