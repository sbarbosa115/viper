import { z } from 'zod';
import { defineContract, err, isoDateTime } from './common.js';

export const toolKey = z
  .string()
  .regex(/^[a-z0-9]+([-.][a-z0-9]+)*$/)
  .max(64);

/** A Tool with its Rate card price and health (FR-23). */
export const tool = z.object({
  key: toolKey,
  name: z.string(),
  provider: z.string(),
  /** e.g. "request", "result", "page", "email", "lookup", "1k tokens in". */
  unit: z.string(),
  providerCostMicrosPerUnit: z.int().nonnegative(),
  /** Decimal, 3 places. */
  creditsPerUnit: z.number().nonnegative(),
  /** 1 − provider cost ÷ (credits × $0.01), as a percentage; null when credits per unit is 0. */
  marginPct: z.number().nullable(),
  enabled: z.boolean(),
  /** Its provider key is present in Platform settings (or it needs none). */
  configured: z.boolean(),
  health: z.object({
    calls24h: z.int().nonnegative(),
    /** Percentage 0–100 of the last 24 h calls that failed; null with no calls. */
    errorRate24h: z.number().min(0).max(100).nullable(),
    lastErrorAt: isoDateTime.nullable(),
    lastError: z.string().nullable(),
  }),
});
export type Tool = z.infer<typeof tool>;

export const listTools = defineContract({
  method: 'GET',
  path: '/api/staff/tools',
  auth: 'staff',
  status: 200,
  response: z.object({ items: z.array(tool) }),
});

export const updateToolBody = z
  .object({
    enabled: z.boolean(),
    creditsPerUnit: z.number().min(0.001).max(10_000),
    providerCostMicrosPerUnit: z.int().min(0).max(100_000_000),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export type UpdateToolBody = z.infer<typeof updateToolBody>;

/** FR-23. Audit log entry `tool.updated`. */
export const updateTool = defineContract({
  method: 'PATCH',
  path: '/api/staff/tools/:key',
  auth: 'staff',
  status: 200,
  params: z.object({ key: toolKey }),
  body: updateToolBody,
  response: tool,
  errors: [err(404, 'NOT_FOUND')],
});

export const toolsContracts = { listTools, updateTool } as const;
