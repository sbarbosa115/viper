import { sql, type Kysely } from 'kysely';

/** Shared infrastructure: the transactional outbox, relayed to BullMQ queues (ADR 0008). */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `CREATE TABLE outbox (
        id CHAR(36) NOT NULL COMMENT 'uuid v7, so ids sort by creation',
        type VARCHAR(64) NOT NULL,
        payload JSON NOT NULL,
        created_at DATETIME(3) NOT NULL,
        dispatched_at DATETIME(3) NULL,
        attempts INT NOT NULL DEFAULT 0,
        last_error VARCHAR(1000) NULL,
        PRIMARY KEY (id),
        KEY outbox_pending (dispatched_at, id),
        KEY outbox_type_created (type, created_at)
      ) ${OPTIONS}`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS outbox').execute(db);
}
