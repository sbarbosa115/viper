import type { LlmRequest, LlmResponse } from '../../application/llm-client.js';

/*
 * Fake-mode answer for planning's draft (TOOLS_MODE=fake, purpose `planning.draft`), so the demo
 * and e2e can create a Plan from a Goal without an Anthropic key. It reads the user message the
 * planning drafter (v1) writes: "Goal: …", "Products:" lines "- id <id>: <name>" and
 * "Business address: <label>".
 */

const DRAFT_TOOL = 'draft_plan';

const SIGNALS: readonly { key: RegExp; fitSignals: string[]; exclusions: string[] }[] = [
  {
    key: /bakeries|bakery/,
    fitSignals: ['Bakes on site', 'Sells bread or pastries daily', 'Independent, not a chain'],
    exclusions: ['Chain bakeries', 'Grocery store bakeries'],
  },
  {
    key: /caf[eé]s?|coffee/,
    fitSignals: ['Serves espresso drinks', 'Independent, not a chain'],
    exclusions: ['Chain coffee shops'],
  },
  {
    key: /restaurants?/,
    fitSignals: ['Cooks from scratch', 'Independent, not a chain'],
    exclusions: ['Fast food chains'],
  },
];

function section(content: string, label: string): string {
  const match = new RegExp(`^${label}: *(.*)$`, 'm').exec(content);
  return match?.[1]?.trim() ?? '';
}

function products(content: string): { id: string; name: string }[] {
  return [...content.matchAll(/^- id (\S+): (.+)$/gm)].map((m) => ({
    id: m[1] ?? '',
    name: m[2] ?? '',
  }));
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function fakePlanDraft(request: LlmRequest): Partial<LlmResponse> {
  const content = request.messages.at(-1)?.content ?? '';
  const goal = section(content, 'Goal');
  const lower = goal.toLowerCase();
  const offered = products(content);

  // "Bakeries within 3 miles that could buy our cane sugar" → segment "Bakeries".
  const head = /^(.+?)(?:\s+(?:within|near|in|around|that|who|which)\b|$)/i.exec(goal);
  const segmentName = capitalize((head?.[1] ?? 'Local businesses').trim()).slice(0, 60);
  // The Product whose name shares the most words with the Goal; the first one otherwise.
  const score = (name: string) =>
    name
      .toLowerCase()
      .split(/[\s,]+/)
      .filter((w) => w.length > 3 && lower.includes(w)).length;
  const product = offered.reduce<{ id: string; name: string } | undefined>(
    (best, p) => (best === undefined || score(p.name) > score(best.name) ? p : best),
    undefined,
  );
  const signals = SIGNALS.find((s) => s.key.test(lower)) ?? {
    fitSignals: ['Independent, not a chain'],
    exclusions: [],
  };

  const near = /\bnear ([a-z .'-]+?)(?:\s+(?:that|who|which|within)\b|$)/i.exec(goal)?.[1]?.trim();
  const address = section(content, 'Business address');
  const ownCity = address.split(',')[1]?.trim() ?? '';
  const place = near && !address.toLowerCase().includes(near.toLowerCase()) ? near : null;
  const miles = /(\d+(?:\.\d+)?)\s*(?:mi\b|miles?)/.exec(lower);
  const km = /(\d+(?:\.\d+)?)\s*(?:km|kilomet)/.exec(lower);
  const radiusMiles = miles
    ? Number(miles[1])
    : km
      ? Math.round(Number(km[1]) * 0.621371 * 10) / 10
      : null;
  const where = place ?? ownCity;

  return {
    toolCall: {
      name: DRAFT_TOOL,
      input: {
        name: (where ? `${segmentName} near ${where}` : segmentName).slice(0, 60),
        segments: [{ name: segmentName, ...signals, productId: product?.id ?? '' }],
        place,
        radiusMiles,
      },
    },
    model: 'fake',
  };
}
