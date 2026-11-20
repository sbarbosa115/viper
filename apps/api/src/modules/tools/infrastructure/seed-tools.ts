import type { ToolRepository } from '../application/ports.js';
import { TOOL_CATALOG } from '../domain/catalog.js';
import { Tool } from '../domain/tool.js';

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
