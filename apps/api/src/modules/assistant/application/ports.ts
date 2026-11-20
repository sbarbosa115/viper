import type { Actor } from '../../../shared/domain/actor.js';
import type { ProfileCommands, ProfileQueries } from '../../profile/index.js';
import type { Topic } from '../domain/welcome-flow.js';

export interface ConversationRecord {
  readonly id: string;
  readonly businessId: string;
  readonly kind: 'welcome';
  readonly createdAt: Date;
}

export interface MessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly quickReplies: readonly string[];
  /** What an assistant message asked about; null for user messages. */
  readonly topic: Topic | null;
  readonly createdAt: Date;
}

export interface ConversationRepository {
  findWelcome(businessId: string): Promise<ConversationRecord | null>;
  findById(id: string): Promise<ConversationRecord | null>;
  /** Creates the Business's welcome Conversation unless it exists; returns the stored one. */
  createWelcome(conversation: ConversationRecord): Promise<ConversationRecord>;
  /** Oldest first. */
  listMessages(conversationId: string): Promise<MessageRecord[]>;
  addMessage(message: MessageRecord): Promise<void>;
  countUserMessagesSince(businessId: string, since: Date): Promise<number>;
}

/** profile's public API (FR-14 updates go through it). */
export type ProfileGateway = Pick<ProfileQueries, 'getProfile'> & ProfileCommands;

/** planning drafts a Plan from the Goal (FR-16); throws ASSISTANT_UNAVAILABLE on LLM failure. */
export interface PlanDrafter {
  draftFromGoal(actor: Actor, goal: string): Promise<{ planId: string }>;
}

/** One model call's usage. W3 meters these as Tool calls with no run (FR-14, G-3). */
export interface LlmUsage {
  readonly businessId: string;
  readonly purpose: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmUsageListener {
  onLlmUsage(usage: LlmUsage): Promise<void> | void;
}

export const ignoreLlmUsage: LlmUsageListener = { onLlmUsage: () => undefined };
