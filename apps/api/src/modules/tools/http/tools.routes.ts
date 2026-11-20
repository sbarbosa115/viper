import { routePath } from '@app/contracts/common';
import { listTools, toolKey, updateTool } from '@app/contracts/tools';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ListTools, UpdateTool } from '../application/tool-catalog.js';

/** The fake Tools' error modes, set by the e2e test route (AJ-5, AJ-9). */
export interface FakeToolSwitch {
  failNext(toolKey: string, n?: number): Promise<void>;
  failAlways(toolKey: string): Promise<void>;
  stall(toolKey: string, ms?: number): Promise<void>;
  heal(toolKey: string): Promise<void>;
  reset(): Promise<void>;
}

export interface ToolsRouteDeps {
  listTools: ListTools;
  updateTool: UpdateTool;
  /** Registers POST /api/test/tools/fail (ENABLE_TEST_HOOKS, never in production). */
  testHooks?: { controls: FakeToolSwitch } | undefined;
}

export const fakeToolFaultBody = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('failNext'), toolKey, n: z.int().min(1).max(1_000).default(1) }),
  z.object({ mode: z.literal('failAlways'), toolKey }),
  z.object({ mode: z.literal('stall'), toolKey, ms: z.int().min(1).max(600_000).default(30_000) }),
  z.object({ mode: z.literal('heal'), toolKey }),
  z.object({ mode: z.literal('reset') }),
]);

/** FR-23 Staff endpoints (PRD section 7, Tools). Staff checks live in the use cases. */
export function toolsRoutes(app: FastifyInstance, deps: ToolsRouteDeps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    routePath(listTools),
    {
      preHandler: app.authenticate,
      schema: { tags: ['tools'], response: { 200: listTools.response } },
    },
    (req) => deps.listTools.execute({ actor: req.actor }),
  );

  api.patch(
    routePath(updateTool),
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['tools'],
        params: updateTool.params,
        body: updateTool.body,
        response: { 200: updateTool.response },
      },
    },
    (req) => deps.updateTool.execute({ actor: req.actor, key: req.params.key, changes: req.body }),
  );

  const hooks = deps.testHooks;
  if (hooks) {
    api.post(
      '/test/tools/fail',
      {
        schema: {
          hide: true,
          body: fakeToolFaultBody,
          response: { 200: z.object({ ok: z.literal(true) }) },
        },
      },
      async (req) => {
        const b = req.body;
        if (b.mode === 'failNext') await hooks.controls.failNext(b.toolKey, b.n);
        else if (b.mode === 'failAlways') await hooks.controls.failAlways(b.toolKey);
        else if (b.mode === 'stall') await hooks.controls.stall(b.toolKey, b.ms);
        else if (b.mode === 'heal') await hooks.controls.heal(b.toolKey);
        else await hooks.controls.reset();
        return { ok: true as const };
      },
    );
  }
}
