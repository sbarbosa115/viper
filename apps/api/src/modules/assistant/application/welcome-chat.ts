import type { Conversation, Message, SendMessageBody } from '@app/contracts/assistant';
import type { Profile } from '@app/contracts/profile';
import type { Geocoder } from '../../../shared/application/geocoder.js';
import {
  LlmUnavailableError,
  type LlmClient,
  type LlmMessage,
  type LlmRequest,
  type LlmResponse,
} from '../../../shared/application/llm-client.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import {
  AppError,
  CodedError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import type { ProfileUpdates } from '../../profile/index.js';
import {
  DAILY_MESSAGE_LIMIT,
  goalSuggestions,
  nextTopic,
  shapeReply,
  startOfUtcDay,
  type Topic,
} from '../domain/welcome-flow.js';
import type {
  ConversationRecord,
  ConversationRepository,
  LlmUsageListener,
  MessageRecord,
  PlanDrafter,
  ProfileGateway,
} from './ports.js';
import {
  EXTRACT_TOOL_NAME,
  extractionSystemPrompt,
  extractTool,
} from './prompts/profile-extraction.v1.js';
import {
  FALLBACK_QUESTION,
  greeting,
  REPLY_TOOL_NAME,
  replySystemPrompt,
  replyTool,
} from './prompts/welcome-reply.v1.js';

export interface WelcomeChatDeps {
  conversations: ConversationRepository;
  profile: ProfileGateway;
  llm: LlmClient;
  geocoder: Geocoder;
  planDrafter: PlanDrafter;
  usage: LlmUsageListener;
  clock: Clock;
  ids: IdGenerator;
  /** Default 60 user messages per Business per UTC day. */
  dailyMessageLimit?: number;
  /** Per model call (default 30 s, FR-14). */
  timeoutMs?: number;
}

export interface SendMessageResult {
  messages: Message[];
  profile: Profile;
  profileComplete: boolean;
  planId: string | null;
}

/** What the model passed to the extraction tool; anything malformed is dropped. */
interface Extraction {
  products?: { name: string; description: string | null }[];
  description?: string | null;
  category?: string | null;
  locationQuery?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  deliveryRadiusMiles?: number | null;
  currentCustomers?: string | null;
  priceRange?: string | null;
  website?: string | null;
  goal?: string | null;
}

const TEXT_FIELDS = [
  'description',
  'category',
  'locationQuery',
  'addressLine1',
  'city',
  'state',
  'postalCode',
  'currentCustomers',
  'priceRange',
  'website',
  'goal',
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Model output is untrusted: keep only well-typed fields. */
function parseExtraction(input: unknown): Extraction {
  const raw = asRecord(input);
  const result: Extraction = {};
  for (const field of TEXT_FIELDS) result[field] = asText(raw[field]);
  if (typeof raw.deliveryRadiusMiles === 'number')
    result.deliveryRadiusMiles = raw.deliveryRadiusMiles;
  if (Array.isArray(raw.products)) {
    result.products = raw.products.flatMap((item) => {
      const p = asRecord(item);
      const name = asText(p.name);
      return name === null ? [] : [{ name, description: asText(p.description) }];
    });
  }
  return result;
}

function parseReply(input: unknown): { text: string; quickReplies: string[] } {
  const raw = asRecord(input);
  return {
    text: asText(raw.text) ?? '',
    quickReplies: Array.isArray(raw.quickReplies)
      ? raw.quickReplies.filter((r): r is string => typeof r === 'string')
      : [],
  };
}

const HISTORY_WINDOW = 20;

function requireOwner(actor: Actor): void {
  if (!actor.roles.includes('owner')) throw new ForbiddenError('Only the Owner can do this');
}

function toMessage(m: MessageRecord): Message {
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    quickReplies: [...m.quickReplies],
    createdAt: m.createdAt.toISOString(),
  };
}

function unavailable(messageId: string): CodedError {
  return new CodedError('ASSISTANT_UNAVAILABLE', "I couldn't reply just now", { messageId });
}

/** A short text from the model, trimmed and clipped to the profile's limit; null when empty. */
function clip(value: string | null | undefined, max: number): string | null {
  const v = value?.trim() ?? '';
  return v === '' ? null : v.slice(0, max);
}

function websiteOf(value: string | null | undefined): string | null {
  const v = clip(value, 2000);
  if (v === null) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

const normalise = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();

/** The profile as the prompts see it (no ids). */
function profileJson(p: Profile): string {
  return JSON.stringify({
    products: p.products.map((x) => x.name),
    description: p.description,
    category: p.category,
    address: p.address,
    location: p.location?.label ?? null,
    deliveryRadiusMiles: p.deliveryRadiusMiles,
    currentCustomers: p.currentCustomers,
    priceRange: p.priceRange,
    website: p.website,
    complete: p.complete,
  });
}

function progressOf(p: Profile) {
  return {
    productsCount: p.products.length,
    hasLocation: p.location !== null,
    hasRadius: p.deliveryRadiusMiles !== null,
    hasCurrentCustomers: p.currentCustomers !== null,
    complete: p.complete,
  };
}

/**
 * The welcome Conversation (FR-14): asks one question at a time, extracts profile updates with
 * the fast model, geocodes the place, asks for the Goal once the profile is complete and turns
 * the Goal into a Plan.
 */
export class WelcomeChat {
  private readonly limit: number;

  constructor(private readonly deps: WelcomeChatDeps) {
    this.limit = deps.dailyMessageLimit ?? DAILY_MESSAGE_LIMIT;
  }

  /** GET /api/conversations/welcome: created (with the first question) on first read. */
  async getWelcome(actor: Actor): Promise<Conversation> {
    requireOwner(actor);
    const conversation = await this.welcomeOf(actor.businessId);
    let messages = await this.deps.conversations.listMessages(conversation.id);
    const profile = await this.deps.profile.getProfile(actor.businessId);
    if (messages.length === 0) {
      const topic = nextTopic(progressOf(profile), new Set());
      const first: MessageRecord = {
        id: this.deps.ids.next(),
        conversationId: conversation.id,
        role: 'assistant',
        text: greeting(profile.businessName, topic),
        quickReplies: topic === 'goal' ? this.suggestions(profile) : [],
        topic,
        createdAt: this.deps.clock.now(),
      };
      await this.deps.conversations.addMessage(first);
      messages = [first];
    }
    return {
      id: conversation.id,
      messages: messages.map(toMessage),
      profileComplete: profile.complete,
    };
  }

  /** POST /api/conversations/:id/messages. The user message is stored before any model call. */
  async send(
    actor: Actor,
    conversationId: string,
    body: SendMessageBody,
  ): Promise<SendMessageResult> {
    requireOwner(actor);
    const { conversations, clock } = this.deps;
    const conversation = await conversations.findById(conversationId);
    if (conversation?.businessId !== actor.businessId) {
      throw new NotFoundError('Conversation not found', { id: conversationId });
    }
    const history = await conversations.listMessages(conversation.id);
    const userMessage = body.retryOfMessageId
      ? this.unanswered(history, body.retryOfMessageId)
      : await this.storeUserMessage(conversation, body.text);
    const earlier = history.filter((m) => m.id !== userMessage.id);
    const lastAssistant = [...earlier].reverse().find((m) => m.role === 'assistant') ?? null;
    const asked: Topic = lastAssistant?.topic ?? 'products';
    const askedTopics = new Set(earlier.flatMap((m) => (m.topic ? [m.topic] : [])));

    const before = await this.deps.profile.getProfile(actor.businessId);
    const extracted = await this.extract(actor, before, asked, lastAssistant, userMessage);
    const located = await this.locate(extracted);
    const updates = this.updatesFrom(extracted, located.location);
    const userCount = earlier.filter((m) => m.role === 'user').length + 1;
    const profile =
      Object.keys(updates).length === 0
        ? before
        : (
            await this.deps.profile.applyUpdates(actor.businessId, updates, {
              via: 'chat',
              messagesCount: userCount,
              memberId: actor.memberId,
            })
          ).profile;

    const goal = clip(extracted.goal, 500);
    const planId =
      asked === 'goal' && profile.complete && goal !== null && goal.length >= 5
        ? await this.draftPlan(actor, goal, userMessage.id)
        : null;

    const topic: Topic = planId
      ? 'planCreated'
      : located.candidates.length > 0
        ? 'locationConfirm'
        : nextTopic(progressOf(profile), askedTopics);
    const answer =
      topic === 'planCreated'
        ? { text: FALLBACK_QUESTION.planCreated, quickReplies: [] }
        : await this.reply(actor, profile, topic, located, [...earlier, userMessage]);

    const assistantMessage: MessageRecord = {
      id: this.deps.ids.next(),
      conversationId: conversation.id,
      role: 'assistant',
      ...answer,
      topic,
      createdAt: clock.now(),
    };
    await conversations.addMessage(assistantMessage);
    return {
      messages: [toMessage(userMessage), toMessage(assistantMessage)],
      profile,
      profileComplete: profile.complete,
      planId,
    };
  }

  private async welcomeOf(businessId: string): Promise<ConversationRecord> {
    const existing = await this.deps.conversations.findWelcome(businessId);
    if (existing) return existing;
    return this.deps.conversations.createWelcome({
      id: this.deps.ids.next(),
      businessId,
      kind: 'welcome',
      createdAt: this.deps.clock.now(),
    });
  }

  /** Retry (FR-14): the stored user message that got no reply, i.e. the last one. */
  private unanswered(history: readonly MessageRecord[], id: string): MessageRecord {
    const last = history.at(-1);
    if (last?.id !== id || last.role !== 'user') {
      throw new NotFoundError('No unanswered message with that id', { retryOfMessageId: id });
    }
    return last;
  }

  private async storeUserMessage(
    conversation: ConversationRecord,
    text: string,
  ): Promise<MessageRecord> {
    const { conversations, clock, ids } = this.deps;
    const now = clock.now();
    const sent = await conversations.countUserMessagesSince(
      conversation.businessId,
      startOfUtcDay(now),
    );
    if (sent >= this.limit) {
      throw new CodedError(
        'TOO_MANY_REQUESTS',
        "That's enough for today. Let's continue tomorrow.",
        {
          limit: this.limit,
        },
      );
    }
    const message: MessageRecord = {
      id: ids.next(),
      conversationId: conversation.id,
      role: 'user',
      text: text.trim(),
      quickReplies: [],
      topic: null,
      createdAt: now,
    };
    await conversations.addMessage(message);
    return message;
  }

  private async call(actor: Actor, request: LlmRequest, messageId: string): Promise<LlmResponse> {
    let response: LlmResponse;
    try {
      response = await this.deps.llm.complete({
        ...request,
        timeoutMs: this.deps.timeoutMs ?? 30_000,
      });
    } catch (error) {
      if (error instanceof LlmUnavailableError) throw unavailable(messageId);
      throw error;
    }
    await this.deps.usage.onLlmUsage({
      businessId: actor.businessId,
      purpose: request.purpose,
      model: response.model,
      ...response.usage,
    });
    return response;
  }

  private async extract(
    actor: Actor,
    profile: Profile,
    asked: Topic,
    lastAssistant: MessageRecord | null,
    userMessage: MessageRecord,
  ): Promise<Extraction> {
    const response = await this.call(
      actor,
      {
        role: 'fast',
        purpose: 'assistant.extract',
        system: extractionSystemPrompt({
          businessName: profile.businessName,
          profileJson: profileJson(profile),
          askedTopic: asked,
          lastQuestion: lastAssistant?.text ?? null,
        }),
        messages: [{ role: 'user', content: userMessage.text }],
        tools: [extractTool],
        maxTokens: 1_024,
      },
      userMessage.id,
    );
    return response.toolCall?.name === EXTRACT_TOOL_NAME
      ? parseExtraction(response.toolCall.input)
      : {};
  }

  /**
   * Geocodes the place the Member gave (FR-14). An ambiguous match is taken only when the
   * Member picked that exact place (a confirm quick reply); otherwise the candidates are offered.
   */
  private async locate(extracted: Extraction): Promise<{
    location: { lat: number; lng: number; label: string } | null;
    candidates: string[];
    notFound: string | null;
  }> {
    const query =
      clip(extracted.locationQuery, 200) ??
      ([extracted.addressLine1, extracted.city, extracted.state, extracted.postalCode]
        .map((p) => clip(p, 200))
        .filter((p): p is string => p !== null)
        .join(', ') ||
        null);
    if (query === null) return { location: null, candidates: [], notFound: null };
    const results = await this.deps.geocoder.search(query, 4);
    const exact = results.find((r) => normalise(r.label) === normalise(query));
    const chosen = exact ?? (results[0] && !results[0].ambiguous ? results[0] : undefined);
    if (chosen) {
      return {
        location: { lat: chosen.lat, lng: chosen.lng, label: chosen.label },
        candidates: [],
        notFound: null,
      };
    }
    if (results.length === 0) return { location: null, candidates: [], notFound: query };
    return { location: null, candidates: results.map((r) => r.label), notFound: null };
  }

  private updatesFrom(
    e: Extraction,
    location: { lat: number; lng: number; label: string } | null,
  ): ProfileUpdates {
    const updates: {
      -readonly [K in keyof ProfileUpdates]: ProfileUpdates[K];
    } = {};
    const products = (e.products ?? [])
      .map((p) => ({ name: clip(p.name, 120), description: clip(p.description, 500) ?? '' }))
      .filter((p): p is { name: string; description: string } => p.name !== null);
    if (products.length > 0) updates.addProducts = products;
    const set = <K extends 'description' | 'category' | 'currentCustomers' | 'priceRange'>(
      key: K,
      value: string | null,
    ) => {
      if (value !== null) updates[key] = value;
    };
    set('description', clip(e.description, 500));
    set('category', clip(e.category, 80));
    set('currentCustomers', clip(e.currentCustomers, 500));
    set('priceRange', clip(e.priceRange, 120));
    const website = websiteOf(e.website);
    if (website !== null) updates.website = website;
    const address: { line1?: string; city?: string; state?: string; postalCode?: string } = {};
    const line1 = clip(e.addressLine1, 200);
    const city = clip(e.city, 100);
    const state = clip(e.state, 50);
    const postalCode = clip(e.postalCode, 20);
    if (line1 !== null) address.line1 = line1;
    if (city !== null) address.city = city;
    if (state !== null) address.state = state;
    if (postalCode !== null) address.postalCode = postalCode;
    if (Object.keys(address).length > 0) updates.address = address;
    if (location) updates.location = location;
    const radius = e.deliveryRadiusMiles;
    if (typeof radius === 'number' && Number.isFinite(radius) && radius >= 0 && radius <= 100) {
      updates.deliveryRadiusMiles = radius;
    }
    return updates;
  }

  private async draftPlan(actor: Actor, goal: string, messageId: string): Promise<string> {
    try {
      return (await this.deps.planDrafter.draftFromGoal(actor, goal)).planId;
    } catch (error) {
      if (
        error instanceof LlmUnavailableError ||
        (error instanceof AppError && error.code === 'ASSISTANT_UNAVAILABLE')
      ) {
        throw unavailable(messageId);
      }
      throw error;
    }
  }

  private suggestions(profile: Profile): string[] {
    return goalSuggestions(
      profile.products.map((p) => p.name),
      profile.deliveryRadiusMiles,
    );
  }

  private async reply(
    actor: Actor,
    profile: Profile,
    topic: Topic,
    located: { candidates: string[]; notFound: string | null },
    conversation: readonly MessageRecord[],
  ): Promise<{ text: string; quickReplies: string[] }> {
    const suggestions = topic === 'goal' ? this.suggestions(profile) : [];
    const lastUser = conversation.at(-1);
    const response = await this.call(
      actor,
      {
        role: 'chat',
        purpose: 'assistant.reply',
        system: replySystemPrompt({
          businessName: profile.businessName,
          profileJson: profileJson(profile),
          nextTopic: topic,
          suggestedGoals: suggestions,
          placeCandidates: located.candidates,
          note: located.notFound ? `We couldn't find "${located.notFound}" on the map.` : null,
        }),
        messages: windowOf(conversation),
        tools: [replyTool],
        maxTokens: 1_024,
      },
      lastUser?.id ?? '',
    );
    const parsed =
      response.toolCall?.name === REPLY_TOOL_NAME
        ? parseReply(response.toolCall.input)
        : { text: response.text, quickReplies: [] };
    const text = parsed.text.trim() === '' ? FALLBACK_QUESTION[topic] : parsed.text;
    const quickReplies =
      topic === 'locationConfirm'
        ? located.candidates
        : topic === 'goal' && parsed.quickReplies.length === 0
          ? suggestions
          : parsed.quickReplies;
    return shapeReply(text, quickReplies);
  }
}

/** The recent conversation for the chat model, starting with a user message. */
function windowOf(messages: readonly MessageRecord[]): LlmMessage[] {
  const recent = messages.slice(-HISTORY_WINDOW);
  const firstUser = recent.findIndex((m) => m.role === 'user');
  return recent.slice(Math.max(firstUser, 0)).map((m) => ({ role: m.role, content: m.text }));
}
