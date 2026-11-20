import type { ClaudeRole } from '../../domain/flow.js';
import type { Prospect, ProspectContact, ProspectEvidence } from '../ports.js';
import {
  asNumber,
  asRecord,
  asString,
  asStrings,
  domainOf,
  fallbackSource,
  type StepContext,
  type WorkItem,
} from './step-context.js';

/**
 * The Steps of "Local buyers" (FR-19) as code: what each Step works through, the research-side
 * tools its agent may call besides the provider Tools, and the Checkpoint it leaves.
 */

export interface InternalToolResult {
  readonly itemsDone: readonly string[];
  readonly view: unknown;
  /** Merged into the Step's progress data. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface InternalTool {
  readonly name: string;
  readonly description: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  /** Applies the agent's call; a string is an error message the agent sees. */
  apply(args: {
    ctx: StepContext;
    input: Record<string, unknown>;
    items: ReadonlyMap<string, WorkItem>;
    data: Readonly<Record<string, unknown>>;
    within: object;
  }): Promise<InternalToolResult | string>;
}

export interface AgentStep {
  readonly kind: 'agent';
  readonly key: string;
  /** The model when the Step lists no Claude Tool (FR-19: planning unless noted). */
  readonly role: ClaudeRole;
  readonly goal: string;
  readonly doneWhen: string;
  /** How many upcoming items the agent sees each turn. */
  readonly itemsShown: number;
  planItems(ctx: StepContext): Promise<WorkItem[]>;
  readonly internalTools: readonly InternalTool[];
  /** Done early (e.g. 400 Prospects found). */
  enough?(data: Readonly<Record<string, unknown>>): boolean;
  finish(
    ctx: StepContext,
    data: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>>;
}

export interface DeterministicStep {
  readonly kind: 'deterministic';
  readonly key: string;
  run(
    ctx: StepContext,
    within: object,
  ): Promise<{ checkpoint: Record<string, unknown>; leadsDelivered?: number }>;
}

export type StepSpec = AgentStep | DeterministicStep;

const MAX_PROSPECTS = 400;
const TOP_FACTOR = 3;

// Helpers ----------------------------------------------------------------------------------------

function liveProspects(all: readonly Prospect[]): Prospect[] {
  return all.filter((p) => p.excluded === null);
}

/** The top Prospects later Steps work on: those Pre-score kept, else the first 3× max leads. */
export async function topProspects(ctx: StepContext): Promise<Prospect[]> {
  const all = liveProspects(await ctx.prospects.listProspects(ctx.runId));
  const kept = ctx.checkpoints.get('pre-score')?.kept;
  if (Array.isArray(kept)) {
    const byId = new Map(all.map((p) => [p.id, p]));
    return kept.map((id) => byId.get(String(id))).filter((p): p is Prospect => p !== undefined);
  }
  return [...all]
    .sort((a, b) => (b.preScore ?? -1) - (a.preScore ?? -1))
    .slice(0, ctx.plan.guardrails.maxLeads * TOP_FACTOR);
}

function segmentOf(ctx: StepContext, segmentId: string | null) {
  return ctx.plan.segments.find((s) => s.id === segmentId) ?? ctx.plan.segments[0] ?? null;
}

function hasUsableContact(p: Prospect): boolean {
  return p.contacts.some(
    (c) => (c.type === 'email' || c.type === 'phone') && c.verification !== 'invalid',
  );
}

function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 7 ? digits : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function itemParam(description: string) {
  return { item: { type: 'string', description } };
}

// 1. Search terms --------------------------------------------------------------------------------

const saveSearchTerms: InternalTool = {
  name: 'save_search_terms',
  description: 'Save 3–8 search terms for one Target segment (the work item).',
  params: {
    ...itemParam('The segment id'),
    terms: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 8 },
  },
  required: ['item', 'terms'],
  apply({ input, items, data }) {
    const id = asString(input.item);
    if (!id || !items.has(id)) return Promise.resolve('Unknown segment');
    const terms = [...new Set(asStrings(input.terms).map((t) => t.toLowerCase().slice(0, 80)))];
    if (terms.length < 3 || terms.length > 8) return Promise.resolve('Give 3 to 8 distinct terms');
    const saved = { ...asRecord(data.terms), [id]: terms };
    return Promise.resolve({ itemsDone: [id], view: { saved: terms }, data: { terms: saved } });
  },
};

const searchTerms: AgentStep = {
  kind: 'agent',
  key: 'search-terms',
  role: 'fast',
  goal: 'Write the search terms people would type into Google Maps to find each Target segment.',
  doneWhen: '3–8 search terms per segment (e.g. "bakery", "pastry shop", "café that bakes").',
  itemsShown: 5,
  planItems(ctx) {
    return Promise.resolve(
      ctx.plan.segments.map((s) => ({
        id: s.id,
        label: s.name,
        data: { fitSignals: s.fitSignals, exclusions: s.exclusions },
      })),
    );
  },
  internalTools: [saveSearchTerms],
  finish(ctx, data) {
    const saved = asRecord(data.terms);
    const terms = ctx.plan.segments.flatMap((s) => {
      const list = asStrings(saved[s.id]);
      return (list.length ? list : [s.name.toLowerCase()]).map((term) => ({
        segmentId: s.id,
        term,
      }));
    });
    return Promise.resolve({ terms });
  },
};

// 2. Maps & places -------------------------------------------------------------------------------

const mapsPlaces: AgentStep = {
  kind: 'agent',
  key: 'maps-places',
  role: 'planning',
  goal: 'Search every term in the search area with the places Tools, to find local businesses.',
  doneWhen: `every term searched in the area, or ${MAX_PROSPECTS} Prospects, or the Step's budget used.`,
  itemsShown: 10,
  planItems(ctx) {
    const terms = ctx.checkpoints.get('search-terms')?.terms;
    const list = Array.isArray(terms) ? terms.map(asRecord) : [];
    return Promise.resolve(
      list
        .map((t) => ({ term: asString(t.term), segmentId: asString(t.segmentId) }))
        .filter((t): t is { term: string; segmentId: string | null } => t.term !== null)
        .map((t) => ({
          id: `${t.segmentId ?? '-'}|${t.term}`,
          label: t.term,
          data: { segmentId: t.segmentId },
        })),
    );
  },
  internalTools: [],
  enough: (data) => (asNumber(data.prospectsFound) ?? 0) >= MAX_PROSPECTS,
  finish: (_ctx, data) => Promise.resolve({ prospectsFound: asNumber(data.prospectsFound) ?? 0 }),
};

// 3. Merge ---------------------------------------------------------------------------------------

const merge: DeterministicStep = {
  kind: 'deterministic',
  key: 'merge',
  async run(ctx, within) {
    const prospects = liveProspects(await ctx.prospects.listProspects(ctx.runId));
    const delivered = await ctx.prospects.alreadyDeliveredPlaceKeys(ctx.plan.id);
    let dropped = 0;
    for (const p of prospects) {
      if (p.placeKeys.some((k) => delivered.has(k))) {
        await ctx.prospects.updateProspect(p.id, { excluded: 'already_delivered' }, within);
        dropped += 1;
      }
    }
    return {
      checkpoint: { prospects: prospects.length - dropped, droppedAlreadyDelivered: dropped },
    };
  },
};

// 4. Pre-score -----------------------------------------------------------------------------------

const savePreScores: InternalTool = {
  name: 'save_pre_scores',
  description: 'Save a 0–100 pre-score for one or more Prospects (work items).',
  params: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
        },
        required: ['item', 'score'],
      },
    },
  },
  required: ['scores'],
  async apply({ ctx, input, items, within }) {
    const scores = (Array.isArray(input.scores) ? input.scores : [])
      .map(asRecord)
      .map((s) => ({ id: asString(s.item), score: asNumber(s.score) }))
      .filter(
        (s): s is { id: string; score: number } =>
          s.id !== null && s.score !== null && items.has(s.id),
      );
    if (scores.length === 0) return 'No valid scores (use the work item ids)';
    for (const s of scores) {
      const score = Math.max(0, Math.min(100, Math.round(s.score)));
      await ctx.prospects.updateProspect(s.id, { preScore: score }, within);
    }
    return { itemsDone: scores.map((s) => s.id), view: { saved: scores.length } };
  },
};

const preScore: AgentStep = {
  kind: 'agent',
  key: 'pre-score',
  role: 'fast',
  goal: 'Score each Prospect 0–100 for how likely it fits the Ideal Customer Profile, from its name, category and rating.',
  doneWhen: 'each Prospect scored; the top 3× max leads are kept.',
  itemsShown: 20,
  async planItems(ctx) {
    const prospects = liveProspects(await ctx.prospects.listProspects(ctx.runId));
    return prospects.map((p) => ({
      id: p.id,
      label: p.name,
      data: {
        category: p.category,
        rating: p.rating,
        reviewsCount: p.reviewsCount,
        segment: segmentOf(ctx, p.segmentId)?.name ?? null,
      },
    }));
  },
  internalTools: [savePreScores],
  async finish(ctx) {
    const prospects = liveProspects(await ctx.prospects.listProspects(ctx.runId));
    const kept = [...prospects]
      .sort((a, b) => (b.preScore ?? -1) - (a.preScore ?? -1))
      .slice(0, ctx.plan.guardrails.maxLeads * TOP_FACTOR)
      .map((p) => p.id);
    return { kept };
  },
};

// 5. Websites ------------------------------------------------------------------------------------

const recordWebsiteFacts: InternalTool = {
  name: 'record_website_facts',
  description:
    'Record what the website says about the Prospect (work item): what it makes or serves, business emails, phones, social links, owner names. Only facts read on the page.',
  params: {
    ...itemParam('The Prospect id'),
    summary: { type: 'string', description: 'What they make or serve, one or two sentences' },
    emails: { type: 'array', items: { type: 'string' } },
    phones: { type: 'array', items: { type: 'string' } },
    instagram: { type: 'string' },
    tiktok: { type: 'string' },
    facebook: { type: 'string' },
    yelp: { type: 'string' },
    ownerNames: { type: 'array', items: { type: 'string' } },
  },
  required: ['item'],
  async apply({ ctx, input, items, within }) {
    const id = asString(input.item);
    const item = id ? items.get(id) : undefined;
    if (!id || !item) return 'Unknown Prospect';
    const source = fallbackSource('Website', asString(item.data.website), ctx.now());
    const contacts: ProspectContact[] = [];
    for (const email of asStrings(input.emails)
      .map((e) => e.toLowerCase())
      .filter((e) => EMAIL.test(e))) {
      contacts.push({ type: 'email', value: email, verification: 'unverified', source });
    }
    for (const phone of asStrings(input.phones)
      .map(normalisePhone)
      .filter((p): p is string => p !== null)) {
      contacts.push({ type: 'phone', value: phone, verification: 'unverified', source });
    }
    for (const type of ['instagram', 'tiktok', 'facebook', 'yelp'] as const) {
      const url = asString(input[type]);
      if (url) contacts.push({ type, value: url, verification: 'unverified', source });
    }
    const summary = asString(input.summary)?.slice(0, 500);
    await ctx.prospects.updateProspect(
      id,
      {
        addContacts: contacts.slice(0, 12),
        addSources: [source],
        ...(summary ? { summary, addEvidence: [{ fact: summary, points: 0, source }] } : {}),
        ownerNames: asStrings(input.ownerNames).slice(0, 5),
      },
      within,
    );
    return { itemsDone: [id], view: { recorded: contacts.length } };
  },
};

const websites: AgentStep = {
  kind: 'agent',
  key: 'websites',
  role: 'fast',
  goal: 'Read each kept Prospect’s website and record what they make or serve, emails, phones, socials and owner names.',
  doneWhen: 'each kept Prospect with a website read.',
  itemsShown: 5,
  async planItems(ctx) {
    return (await topProspects(ctx))
      .filter((p) => p.website)
      .map((p) => ({ id: p.id, label: p.name, data: { prospectId: p.id, website: p.website } }));
  },
  internalTools: [recordWebsiteFacts],
  finish: () => Promise.resolve({}),
};

// 6. Socials & reviews ---------------------------------------------------------------------------

function socialsSpec(toolFor: { instagram: string; yelp: string }): AgentStep {
  return {
    kind: 'agent',
    key: 'socials-reviews',
    role: 'planning',
    goal: 'Check the top Prospects’ Instagram and Yelp pages; their bio, followers and review snippets become Evidence.',
    doneWhen: 'Instagram and Yelp links checked for the top Prospects.',
    itemsShown: 10,
    async planItems(ctx) {
      const items: WorkItem[] = [];
      for (const p of await topProspects(ctx)) {
        for (const channel of ['instagram', 'yelp'] as const) {
          const link = p.contacts.find((c) => c.type === channel);
          if (link) {
            items.push({
              id: `${p.id}|${channel}`,
              label: `${p.name} (${channel})`,
              data: { prospectId: p.id, url: link.value },
              tools: [toolFor[channel]],
            });
          }
        }
      }
      return items;
    },
    internalTools: [],
    finish: () => Promise.resolve({}),
  };
}

// 7. Contacts ------------------------------------------------------------------------------------

const contacts: AgentStep = {
  kind: 'agent',
  key: 'contacts',
  role: 'planning',
  goal: 'Find a business email for each top Prospect that has none, from its domain.',
  doneWhen: 'an email found for each top Prospect where possible.',
  itemsShown: 10,
  async planItems(ctx) {
    return (await topProspects(ctx))
      .filter((p) => !p.contacts.some((c) => c.type === 'email' && c.verification !== 'invalid'))
      .map((p) => ({ p, domain: p.domain ?? domainOf(p.website) }))
      .filter((x): x is { p: Prospect; domain: string } => x.domain !== null)
      .map(({ p, domain }) => ({ id: p.id, label: p.name, data: { prospectId: p.id, domain } }));
  },
  internalTools: [],
  finish: () => Promise.resolve({}),
};

// 8. Verify --------------------------------------------------------------------------------------

function verifySpec(toolFor: { email: string; phone: string }): AgentStep {
  return {
    kind: 'agent',
    key: 'verify',
    role: 'planning',
    goal: 'Check every email and phone of the top Prospects.',
    doneWhen: 'every email and phone of the top Prospects checked.',
    itemsShown: 10,
    async planItems(ctx) {
      const items: WorkItem[] = [];
      for (const p of await topProspects(ctx)) {
        for (const c of p.contacts) {
          if ((c.type !== 'email' && c.type !== 'phone') || c.verification !== 'unverified')
            continue;
          items.push({
            id: `${p.id}|${c.type}|${c.value}`,
            label: `${p.name}: ${c.value}`,
            data: { prospectId: p.id, type: c.type, value: c.value },
            tools: [toolFor[c.type]],
          });
        }
      }
      return items;
    },
    internalTools: [],
    finish: () => Promise.resolve({}),
  };
}

// 9. Score & pitch -------------------------------------------------------------------------------

const MAX_SCORES_PER_TURN = 5;

const scoreSchema = {
  type: 'object',
  properties: {
    item: { type: 'string', description: 'The Prospect id' },
    fitScore: { type: 'integer', minimum: 0, maximum: 100 },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact: { type: 'string' },
          points: { type: 'integer' },
          sourceIndex: { type: 'integer', minimum: 0 },
        },
        required: ['fact', 'points', 'sourceIndex'],
      },
    },
    pitch: {
      type: 'object',
      properties: { productId: { type: 'string' }, reason: { type: 'string' } },
      required: ['reason'],
    },
  },
  required: ['item', 'fitScore', 'evidence', 'pitch'],
};

/** One Prospect's score, validated; a string is the error the agent sees. */
async function saveOneScore(
  ctx: StepContext,
  raw: Record<string, unknown>,
  items: ReadonlyMap<string, WorkItem>,
  within: object,
): Promise<string | null> {
  const id = asString(raw.item);
  const item = id ? items.get(id) : undefined;
  if (!id || !item) return 'Unknown Prospect';
  const fitScore = asNumber(raw.fitScore);
  if (fitScore === null || fitScore < 0 || fitScore > 100) return 'fitScore must be 0–100';
  const sources = Array.isArray(item.data.sources) ? item.data.sources.map(asRecord) : [];
  const evidence: ProspectEvidence[] = (Array.isArray(raw.evidence) ? raw.evidence : [])
    .map(asRecord)
    .map((e) => ({
      fact: asString(e.fact),
      points: asNumber(e.points) ?? 0,
      source: sources[asNumber(e.sourceIndex) ?? -1],
    }))
    .filter((e) => e.fact !== null && e.source !== undefined)
    .slice(0, 10)
    .map((e) => ({
      fact: String(e.fact).slice(0, 300),
      points: Math.round(e.points),
      source: {
        name: asString(e.source?.name) ?? 'Source',
        url: asString(e.source?.url),
        retrievedAt: asString(e.source?.retrievedAt) ?? ctx.now().toISOString(),
      },
    }));
  if (evidence.length === 0) return 'Give at least one Evidence item with a valid sourceIndex';
  const pitch = asRecord(raw.pitch);
  const reason = asString(pitch.reason);
  if (!reason) return 'The Pitch needs a reason';
  const segment = segmentOf(ctx, asString(item.data.segmentId));
  const product =
    ctx.plan.segments.find((s) => s.productId === asString(pitch.productId)) ?? segment;
  if (!product) return 'Unknown Product';
  await ctx.prospects.updateProspect(
    id,
    {
      fitScore: Math.round(fitScore),
      addEvidence: evidence,
      pitch: {
        productId: product.productId,
        productName: product.productName ?? null,
        reason: reason.slice(0, 500),
      },
    },
    within,
  );
  return null;
}

const saveScores: InternalTool = {
  name: 'save_scores',
  description: `Save the Fit score (0–100) of up to ${MAX_SCORES_PER_TURN} Prospects (work items), each with its Evidence (facts with points and the index of their Source in the item's sources) and a Pitch (which Product to offer and why).`,
  params: {
    scores: { type: 'array', items: scoreSchema, minItems: 1, maxItems: MAX_SCORES_PER_TURN },
  },
  required: ['scores'],
  async apply({ ctx, input, items, within }) {
    const scores = (Array.isArray(input.scores) ? input.scores : [])
      .map(asRecord)
      .slice(0, MAX_SCORES_PER_TURN);
    if (scores.length === 0) return 'Give at least one score';
    const saved: string[] = [];
    const errors: Record<string, string> = {};
    for (const raw of scores) {
      const error = await saveOneScore(ctx, raw, items, within);
      const id = asString(raw.item) ?? '?';
      if (error) errors[id] = error;
      else saved.push(id);
    }
    return { itemsDone: saved, view: { saved: saved.length, errors } };
  },
};

const scorePitch: AgentStep = {
  kind: 'agent',
  key: 'score-pitch',
  role: 'planning',
  goal: 'Give each top Prospect a Fit score with Evidence (each fact with its Source and points) and a Pitch: which Product to offer and why.',
  doneWhen: 'a Fit score with Evidence and a Pitch per Prospect.',
  itemsShown: 3,
  async planItems(ctx) {
    return (await topProspects(ctx)).filter(hasUsableContact).map((p) => {
      const segment = segmentOf(ctx, p.segmentId);
      return {
        id: p.id,
        label: p.name,
        data: {
          segmentId: segment?.id ?? null,
          category: p.category,
          rating: p.rating,
          reviewsCount: p.reviewsCount,
          summary: p.summary,
          segment: segment
            ? {
                name: segment.name,
                fitSignals: segment.fitSignals,
                exclusions: segment.exclusions,
                productId: segment.productId,
                productName: segment.productName ?? null,
              }
            : null,
          contacts: p.contacts.map((c) => ({ type: c.type, verification: c.verification })),
          facts: p.evidence.map((e) => e.fact).slice(0, 8),
          sources: p.sources.slice(0, 8),
        },
      };
    });
  },
  internalTools: [saveScores],
  finish: () => Promise.resolve({}),
};

// 10. Deliver ------------------------------------------------------------------------------------

const deliver: DeterministicStep = {
  kind: 'deterministic',
  key: 'deliver',
  async run(ctx, within) {
    const { delivered } = await ctx.prospects.deliver(
      {
        runId: ctx.runId,
        businessId: ctx.businessId,
        planId: ctx.plan.id,
        minFitScore: ctx.plan.guardrails.minFitScore,
        maxLeads: ctx.plan.guardrails.maxLeads,
      },
      within,
    );
    return { checkpoint: { delivered }, leadsDelivered: delivered };
  },
};

/** The Step specs by key. Tool keys for channel-specific items come from the flow's Tools. */
export function stepSpecs(toolKeys: {
  instagram: string;
  yelp: string;
  zerobounce: string;
  twilio: string;
}): ReadonlyMap<string, StepSpec> {
  const specs: StepSpec[] = [
    searchTerms,
    mapsPlaces,
    merge,
    preScore,
    websites,
    socialsSpec({ instagram: toolKeys.instagram, yelp: toolKeys.yelp }),
    contacts,
    verifySpec({ email: toolKeys.zerobounce, phone: toolKeys.twilio }),
    scorePitch,
    deliver,
  ];
  return new Map(specs.map((s) => [s.key, s]));
}
