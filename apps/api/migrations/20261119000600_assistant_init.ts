import { sql, type Kysely } from 'kysely';

/** assistant: Conversations and messages (PRD section 8). */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const statements = [
  `CREATE TABLE conversations (
    id CHAR(36) NOT NULL,
    business_id CHAR(36) NOT NULL,
    kind ENUM('welcome') NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY conversations_business_kind (business_id, kind)
  ) ${OPTIONS}`,
  `CREATE TABLE messages (
    id CHAR(36) NOT NULL,
    conversation_id CHAR(36) NOT NULL,
    role ENUM('user','assistant') NOT NULL,
    text VARCHAR(2000) NOT NULL,
    quick_replies JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY messages_conversation_created (conversation_id, created_at),
    KEY messages_role_created (role, created_at),
    CONSTRAINT messages_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
  ) ${OPTIONS}`,
];

const tables = ['messages', 'conversations'];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of statements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of tables) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
