import { healthResponse, type HealthResponse } from '@app/contracts/health';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

export type HealthProbes = Record<string, () => Promise<unknown>>;

export function healthRoutes(app: FastifyInstance, probes: HealthProbes): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        tags: ['health'],
        response: { 200: healthResponse, 503: healthResponse },
      },
      config: { rateLimit: false },
    },
    async (_req, reply) => {
      const checks: HealthResponse['checks'] = {};
      await Promise.all(
        Object.entries(probes).map(async ([name, probe]) => {
          try {
            await Promise.race([
              probe(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 3000).unref(),
              ),
            ]);
            checks[name] = 'ok';
          } catch {
            checks[name] = 'down';
          }
        }),
      );
      const healthy = Object.values(checks).every((c) => c === 'ok');
      return reply
        .status(healthy ? 200 : 503)
        .send({ status: healthy ? 'ok' : 'degraded', checks });
    },
  );
}
