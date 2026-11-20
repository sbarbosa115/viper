import { z } from 'zod';

export const healthCheckStatus = z.enum(['ok', 'down']);

export const healthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(z.string(), healthCheckStatus),
});
export type HealthResponse = z.infer<typeof healthResponse>;
