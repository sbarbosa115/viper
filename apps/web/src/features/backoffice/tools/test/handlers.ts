import { errorResponse } from '@app/contracts/errors';
import { tool as example } from '@app/contracts/examples';
import { listTools, updateTool, updateToolBody, type Tool } from '@app/contracts/tools';
import { http, HttpResponse } from 'msw';

const margin = (credits: number, micros: number) =>
  credits > 0 ? Math.round((1 - micros / 1_000_000 / (credits * 0.01)) * 100) : null;

const instagram: Tool = {
  ...example,
  key: 'apify.instagram',
  name: 'Apify Instagram profile',
  provider: 'apify',
  unit: 'result',
  providerCostMicrosPerUnit: 2600,
  creditsPerUnit: 0.5,
  marginPct: margin(0.5, 2600),
  health: { calls24h: 640, errorRate24h: 3.4, lastErrorAt: null, lastError: null },
};
const hunter: Tool = {
  ...example,
  key: 'hunter.domain-search',
  name: 'Hunter domain search',
  provider: 'hunter',
  unit: 'lookup',
  providerCostMicrosPerUnit: 15000,
  creditsPerUnit: 4,
  marginPct: margin(4, 15000),
  configured: false,
  enabled: false,
  health: { calls24h: 0, errorRate24h: null, lastErrorAt: null, lastError: null },
};

export const toolsState: {
  tools: Tool[];
  patches: { key: string; body: unknown }[];
  failKey: string | null;
} = { tools: [], patches: [], failKey: null };

export function resetToolsState() {
  toolsState.tools = [example, instagram, hunter];
  toolsState.patches = [];
  toolsState.failKey = null;
}
resetToolsState();

export const handlers = [
  http.get('*/api/staff/tools', () =>
    HttpResponse.json(listTools.response.parse({ items: toolsState.tools })),
  ),

  http.patch('*/api/staff/tools/:key', async ({ params, request }) => {
    const key = String(params.key);
    const parsed = updateToolBody.safeParse(await request.json());
    if (!parsed.success || key === toolsState.failKey) {
      return HttpResponse.json(
        errorResponse.parse({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid',
            fields: { creditsPerUnit: 'Must be at least 0.001' },
          },
        }),
        { status: 400 },
      );
    }
    const found = toolsState.tools.find((t) => t.key === key);
    if (!found) {
      return HttpResponse.json(
        errorResponse.parse({ error: { code: 'NOT_FOUND', message: 'No tool' } }),
        { status: 404 },
      );
    }
    toolsState.patches.push({ key, body: parsed.data });
    const merged = { ...found, ...parsed.data };
    const updated = {
      ...merged,
      marginPct: margin(merged.creditsPerUnit, merged.providerCostMicrosPerUnit),
    };
    toolsState.tools = toolsState.tools.map((t) => (t.key === key ? updated : t));
    return HttpResponse.json(updateTool.response.parse(updated));
  }),
];
