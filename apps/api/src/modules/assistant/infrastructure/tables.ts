import type { Json, Timestamp } from '../../../shared/infrastructure/db/schema.js';

export interface ConversationsTable {
  id: string;
  business_id: string;
  kind: 'welcome';
  created_at: Timestamp;
}

export interface MessagesTable {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  text: string;
  quick_replies: Json<string[]>;
  /** What an assistant message asked about (migration 20261119200000); null for user messages. */
  topic: string | null;
  created_at: Timestamp;
}

export interface AssistantTables {
  conversations: ConversationsTable;
  messages: MessagesTable;
}
