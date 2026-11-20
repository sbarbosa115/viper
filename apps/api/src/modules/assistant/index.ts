import type { FastifyInstance } from 'fastify';
import type { Geocoder } from '../../shared/application/geocoder.js';
import type { LlmClient } from '../../shared/application/llm-client.js';
import type { Clock } from '../../shared/domain/clock.js';
import { CodedError } from '../../shared/domain/errors.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import {
  ignoreLlmUsage,
  type ConversationRepository,
  type LlmUsageListener,
  type PlanDrafter,
  type ProfileGateway,
} from './application/ports.js';
import { WelcomeChat } from './application/welcome-chat.js';
import { assistantRoutes } from './http/assistant.routes.js';
import {
  InMemoryConversationRepository,
  KyselyConversationRepository,
} from './infrastructure/conversation-repositories.js';

export type {
  LlmUsage,
  LlmUsageListener,
  PlanDrafter,
  ProfileGateway,
} from './application/ports.js';
export { PROFILE_EXTRACTION_VERSION } from './application/prompts/profile-extraction.v1.js';
export { WELCOME_REPLY_VERSION } from './application/prompts/welcome-reply.v1.js';

/** The HTTP module's shape (matches app.ts AppModule). */
export interface AssistantHttpModule {
  readonly name: 'assistant';
  register(app: FastifyInstance): void;
}

export interface Assistant {
  module: AssistantHttpModule;
  chat: WelcomeChat;
}

export interface AssistantDeps {
  clock: Clock;
  ids: IdGenerator;
  /** profile's public API: `getProfile` (ProfileQueries) and `applyUpdates` (ProfileCommands). */
  profile: ProfileGateway;
  /** AnthropicLlmClient, or ScriptedLlmClient.fakeMode() with TOOLS_MODE=fake. */
  llm: LlmClient;
  geocoder: Geocoder;
  /** planning's draft from a Goal (FR-16). */
  planDrafter: PlanDrafter;
  /** W3 meters chat Claude calls as Tool calls with no run; ignored when absent. */
  usage?: LlmUsageListener;
  /** 60 per Business per UTC day when absent. */
  dailyMessageLimit?: number;
}

function assemble(conversations: ConversationRepository, deps: AssistantDeps): Assistant {
  const chat = new WelcomeChat({ ...deps, conversations, usage: deps.usage ?? ignoreLlmUsage });
  return {
    chat,
    module: { name: 'assistant', register: (app) => assistantRoutes(app, { chat }) },
  };
}

/** assistant: the welcome Conversation that builds the Business Profile (FR-14), on MySQL. */
export function createAssistant(deps: AssistantDeps & { db: Database }): Assistant {
  return assemble(new KyselyConversationRepository(deps.db), deps);
}

/** The same module with in-memory Conversations (tests). */
export function createInMemoryAssistant(
  deps: AssistantDeps,
): Assistant & { conversations: InMemoryConversationRepository } {
  const conversations = new InMemoryConversationRepository();
  return { ...assemble(conversations, deps), conversations };
}

/**
 * Until planning provides `draftFromGoal`: answering the Goal replies 503 ASSISTANT_UNAVAILABLE
 * (the message is kept, so Retry works once planning is wired).
 */
export const unavailablePlanDrafter: PlanDrafter = {
  draftFromGoal: () =>
    Promise.reject(new CodedError('ASSISTANT_UNAVAILABLE', 'Plans are not available yet')),
};

/**
 * Placeholder kept so composition.ts compiles until it registers `createAssistant(...).module`
 * instead.
 */
export const assistantModule = {
  name: 'assistant',
  register(_app: FastifyInstance): void {
    // Replaced by createAssistant(...).module in the composition root.
  },
};

/**
 * Demo data (PRD section 8a): nothing, conversations start empty (created on first read).
 * Kept for symmetry with the other modules' seeds.
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}
