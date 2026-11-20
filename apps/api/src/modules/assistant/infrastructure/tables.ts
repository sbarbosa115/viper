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
  created_at: Timestamp;
}

export interface AssistantTables {
  conversations: ConversationsTable;
  messages: MessagesTable;
}
