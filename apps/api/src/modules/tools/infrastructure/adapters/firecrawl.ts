import type { Clock } from '../../../../shared/domain/clock.js';
import type { ProviderSettings } from '../../application/ports.js';
import { registerAdapter } from './register.js';
import { ToolFailure, type RegisteredAdapter } from '../../application/tool-adapter.js';
import { MAX_MARKDOWN_CHARS, scrapeInput, scrapeOutput, type ScrapeInput } from '../tool-io.js';
import { TOOL_KEYS } from '../../domain/tool-keys.js';
import { requestJson, requireKey, type Fetch } from './http.js';

export const FIRECRAWL_URL = 'https://api.firecrawl.dev/v2/scrape';
const PROVIDER = 'Firecrawl';

interface ScrapeBody {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: string;
    metadata?: { title?: string; sourceURL?: string; url?: string; statusCode?: number };
  };
}

/** Firecrawl scrape: a page's main content as Markdown (1 page). */
export function firecrawlAdapter(deps: {
  settings: ProviderSettings;
  clock: Clock;
  fetch?: Fetch;
}): RegisteredAdapter {
  const fetchFn = deps.fetch ?? fetch;
  return registerAdapter({
    key: TOOL_KEYS.firecrawl,
    requires: 'firecrawl',
    input: scrapeInput,
    output: scrapeOutput,
    maxUnits: () => 1,
    async run(input: ScrapeInput) {
      const apiKey = requireKey((await deps.settings.provider('firecrawl')).apiKey, PROVIDER);
      const body = (await requestJson(
        fetchFn,
        PROVIDER,
        FIRECRAWL_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            url: input.url,
            formats: ['markdown'],
            onlyMainContent: true,
            timeout: 30_000,
          }),
        },
        45_000,
      )) as ScrapeBody | null;
      if (!body?.success || !body.data) {
        throw ToolFailure.final(
          `Firecrawl could not read the page${body?.error ? `: ${body.error.slice(0, 200)}` : ''}`,
        );
      }
      const meta = body.data.metadata ?? {};
      const url = meta.sourceURL ?? meta.url ?? input.url;
      return {
        output: {
          url,
          title: meta.title ?? null,
          markdown: (body.data.markdown ?? '').slice(0, MAX_MARKDOWN_CHARS),
          statusCode: meta.statusCode ?? null,
          source: { name: 'Website', url, retrievedAt: deps.clock.now().toISOString() },
        },
        units: 1,
      };
    },
  });
}
