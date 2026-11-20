import type { LlmRequest, LlmResponse } from '../../../shared/application/llm-client.js';
import { readState } from '../application/prompts/v1.js';

/**
 * The research agent in TOOLS_MODE=fake (dev, e2e) and in tests: a deterministic stand-in for
 * Claude that reads the STATE line of the last message and issues sensible tool calls per Step,
 * so a full run completes on the fake Tools' fixture data. Never used in production.
 */
export const FAKE_AGENT_MODEL = 'fake-research-agent';

interface StateItem {
  id: string;
  label: string;
  data: Record<string, unknown>;
  tools?: string[];
}

const text = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function isResearchRequest(request: LlmRequest): boolean {
  return request.purpose.startsWith('research.step.');
}

function respond(
  name: string,
  input: Record<string, unknown>,
  request: LlmRequest,
): Partial<LlmResponse> {
  const chars = request.messages.reduce((n, m) => n + m.content.length, request.system.length);
  return {
    text: '',
    toolCall: { name, input },
    usage: { inputTokens: Math.ceil(chars / 4), outputTokens: 60 },
    model: FAKE_AGENT_MODEL,
  };
}

function termsFor(segment: string): string[] {
  const base = segment.toLowerCase().trim();
  const singular = base.replace(/ies$/, 'y').replace(/s$/, '');
  return [...new Set([singular, base, `${singular} near me`, `local ${singular}`])].slice(0, 4);
}

function preScore(data: Record<string, unknown>): number {
  const rating = typeof data.rating === 'number' ? data.rating : null;
  const category = typeof data.category === 'string' ? data.category.toLowerCase() : '';
  let score = rating === null ? 40 : Math.round(rating * 12);
  if (/bak|pastr|dessert|café|cafe|donut|doughnut|cake/.test(category)) score += 15;
  return Math.max(0, Math.min(100, score));
}

function websiteFacts(markdown: string): Record<string, unknown> {
  const emails = [...new Set(markdown.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])];
  const phones = [...new Set(markdown.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? [])];
  const link = (pattern: RegExp) => markdown.match(pattern)?.[0] ?? undefined;
  const firstLine = markdown
    .split('\n')
    .find((l) => l.trim() && !l.startsWith('#'))
    ?.trim();
  return {
    summary: firstLine?.slice(0, 200),
    emails: emails.slice(0, 3),
    phones: phones.slice(0, 2),
    instagram: link(/https?:\/\/(www\.)?instagram\.com\/[\w.]+/),
    yelp: link(/https?:\/\/(www\.)?yelp\.com\/biz\/[\w-]+/),
    facebook: link(/https?:\/\/(www\.)?facebook\.com\/[\w.]+/),
  };
}

function fitScore(data: Record<string, unknown>): number {
  const rating = typeof data.rating === 'number' ? data.rating : 3;
  const contacts = Array.isArray(data.contacts) ? data.contacts.map(record) : [];
  const verified = contacts.filter((c) => c.verification === 'verified').length;
  const facts = Array.isArray(data.facts) ? data.facts.length : 0;
  const score = Math.round(rating * 12 + Math.min(verified, 2) * 5 + Math.min(facts, 4) * 2);
  return Math.max(0, Math.min(98, score));
}

/** One deterministic agent turn. */
export function fakeResearchAgent(request: LlmRequest): Partial<LlmResponse> {
  const step = request.purpose.replace('research.step.', '');
  const last = request.messages[request.messages.length - 1]?.content ?? '';
  const state = readState(last);
  const items = (Array.isArray(state?.nextItems) ? state.nextItems : []) as StateItem[];
  const tools = (Array.isArray(state?.tools) ? state.tools : []) as string[];
  const lastResult = record(state?.lastResult);
  const done = Number(state?.itemsDone ?? 0);
  const total = done + Number(state?.itemsLeft ?? 0);
  const item = items[0];
  const notes = item
    ? `${step}: ${done} of ${total} items done; next "${item.label}".`
    : `${step}: all ${total} items done.`;
  if (!state || !item) return respond('finish_step', { notes }, request);

  const providerTool = (it: StateItem) => it.tools?.[0] ?? tools.find((t) => t.includes('__'));
  /** One provider turn for the first item and the next items that use the same Tool. */
  const callProvider = (extra: Record<string, unknown> = {}, batch = true) => {
    const tool = providerTool(item);
    if (!tool) return respond('finish_step', { notes }, request);
    const ids = batch
      ? items.filter((it) => providerTool(it) === tool).map((it) => it.id)
      : [item.id];
    return respond(tool, { items: ids, ...extra, notes }, request);
  };

  switch (step) {
    case 'search-terms':
      return respond(
        'save_search_terms',
        { item: item.id, terms: termsFor(item.label), notes },
        request,
      );
    case 'maps-places':
      return callProvider({ query: item.label }, false);
    case 'pre-score':
      return respond(
        'save_pre_scores',
        { scores: items.map((it) => ({ item: it.id, score: preScore(it.data) })), notes },
        request,
      );
    case 'websites': {
      const results = Array.isArray(lastResult.results) ? lastResult.results.map(record) : [];
      const read = results.find((r) => r.item === item.id && r.status === 'ok');
      if (read) {
        const output = record(read.output);
        const facts = websiteFacts(typeof output.markdown === 'string' ? output.markdown : '');
        return respond('record_website_facts', { item: item.id, ...facts, notes }, request);
      }
      return callProvider({}, false);
    }
    case 'score-pitch':
      return respond('save_scores', { scores: items.map(scoreFor), notes }, request);
    default:
      return callProvider();
  }
}

function scoreFor(item: StateItem): Record<string, unknown> {
  const segment = record(item.data.segment);
  const facts = Array.isArray(item.data.facts) ? item.data.facts.map(String) : [];
  return {
    item: item.id,
    fitScore: fitScore(item.data),
    evidence: [
      {
        fact: `Listed as ${text(item.data.category, 'a local business')}`,
        points: 20,
        sourceIndex: 0,
      },
      ...facts.slice(0, 2).map((fact) => ({ fact, points: 10, sourceIndex: 0 })),
    ],
    pitch: {
      productId: segment.productId,
      reason: `${item.label} fits "${text(segment.name, 'the segment')}" and could use ${text(segment.productName, 'the Product')}.`,
    },
  };
}
