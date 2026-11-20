import type { Database } from '../../../shared/infrastructure/db/database.js';
import { isTopic } from '../domain/welcome-flow.js';
import type {
  ConversationRecord,
  ConversationRepository,
  MessageRecord,
} from '../application/ports.js';

const byCreated = (a: MessageRecord, b: MessageRecord) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

/** In-memory Conversations (tests). */
export class InMemoryConversationRepository implements ConversationRepository {
  readonly conversations = new Map<string, ConversationRecord>();
  readonly messages: MessageRecord[] = [];

  findWelcome(businessId: string): Promise<ConversationRecord | null> {
    const found = [...this.conversations.values()].find(
      (c) => c.businessId === businessId && c.kind === 'welcome',
    );
    return Promise.resolve(found ?? null);
  }

  findById(id: string): Promise<ConversationRecord | null> {
    return Promise.resolve(this.conversations.get(id) ?? null);
  }

  async createWelcome(conversation: ConversationRecord): Promise<ConversationRecord> {
    const existing = await this.findWelcome(conversation.businessId);
    if (existing) return existing;
    this.conversations.set(conversation.id, { ...conversation });
    return conversation;
  }

  listMessages(conversationId: string): Promise<MessageRecord[]> {
    return Promise.resolve(
      this.messages
        .filter((m) => m.conversationId === conversationId)
        .sort(byCreated)
        .map((m) => ({ ...m, quickReplies: [...m.quickReplies] })),
    );
  }

  addMessage(message: MessageRecord): Promise<void> {
    this.messages.push({ ...message, quickReplies: [...message.quickReplies] });
    return Promise.resolve();
  }

  countUserMessagesSince(businessId: string, since: Date): Promise<number> {
    const ids = new Set(
      [...this.conversations.values()].filter((c) => c.businessId === businessId).map((c) => c.id),
    );
    return Promise.resolve(
      this.messages.filter(
        (m) => m.role === 'user' && ids.has(m.conversationId) && m.createdAt >= since,
      ).length,
    );
  }
}

/** Conversations and messages on MySQL. */
export class KyselyConversationRepository implements ConversationRepository {
  constructor(private readonly db: Database) {}

  async findWelcome(businessId: string): Promise<ConversationRecord | null> {
    const row = await this.db
      .selectFrom('conversations')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('kind', '=', 'welcome')
      .executeTakeFirst();
    return row ? toConversation(row) : null;
  }

  async findById(id: string): Promise<ConversationRecord | null> {
    const row = await this.db
      .selectFrom('conversations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toConversation(row) : null;
  }

  /** INSERT IGNORE on the (business_id, kind) unique key, so two first reads create one. */
  async createWelcome(conversation: ConversationRecord): Promise<ConversationRecord> {
    await this.db
      .insertInto('conversations')
      .ignore()
      .values({
        id: conversation.id,
        business_id: conversation.businessId,
        kind: conversation.kind,
        created_at: conversation.createdAt,
      })
      .execute();
    const stored = await this.findWelcome(conversation.businessId);
    if (!stored) throw new Error('Welcome conversation was not created');
    return stored;
  }

  async listMessages(conversationId: string): Promise<MessageRecord[]> {
    const rows = await this.db
      .selectFrom('messages')
      .selectAll()
      .where('conversation_id', '=', conversationId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role,
      text: r.text,
      quickReplies: r.quick_replies,
      topic: isTopic(r.topic) ? r.topic : null,
      createdAt: r.created_at,
    }));
  }

  async addMessage(message: MessageRecord): Promise<void> {
    await this.db
      .insertInto('messages')
      .values({
        id: message.id,
        conversation_id: message.conversationId,
        role: message.role,
        text: message.text,
        quick_replies: JSON.stringify(message.quickReplies),
        topic: message.topic,
        created_at: message.createdAt,
      })
      .execute();
  }

  async countUserMessagesSince(businessId: string, since: Date): Promise<number> {
    const row = await this.db
      .selectFrom('messages')
      .innerJoin('conversations', 'conversations.id', 'messages.conversation_id')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('conversations.business_id', '=', businessId)
      .where('messages.role', '=', 'user')
      .where('messages.created_at', '>=', since)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }
}

function toConversation(row: {
  id: string;
  business_id: string;
  kind: 'welcome';
  created_at: Date;
}): ConversationRecord {
  return { id: row.id, businessId: row.business_id, kind: row.kind, createdAt: row.created_at };
}
