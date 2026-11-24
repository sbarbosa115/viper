import { sql, type Kysely } from 'kysely';

/**
 * support: Tickets, their messages (customer replies, Staff replies, Internal notes, events) and
 * per-Staff read state (prd-support section 8, ADR 0021). Ticket numbers come from AUTO_INCREMENT,
 * starting at 1001. Deleting a Business deletes its Tickets, their messages and views.
 */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const statements = [
  `CREATE TABLE support_tickets (
    id CHAR(36) NOT NULL,
    number INT UNSIGNED NOT NULL AUTO_INCREMENT,
    business_id CHAR(36) NOT NULL,
    opened_by_member_id CHAR(36) NOT NULL,
    category ENUM('billing','run','account','bug','other') NOT NULL,
    subject VARCHAR(120) NOT NULL,
    status ENUM('open','in_progress','waiting_on_customer','closed') NOT NULL,
    assignee_member_id CHAR(36) NULL,
    run_id CHAR(36) NULL COMMENT 'research run; no FK across contexts',
    source ENUM('help','run','leads') NOT NULL,
    page_path VARCHAR(200) NULL,
    balance_at_open INT NULL COMMENT 'credits',
    version INT NOT NULL DEFAULT 0,
    waiting_since DATETIME(3) NULL,
    first_staff_reply_at DATETIME(3) NULL,
    last_message_at DATETIME(3) NOT NULL,
    last_message_by ENUM('customer','staff') NOT NULL,
    closed_at DATETIME(3) NULL,
    closed_by ENUM('customer','staff') NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY support_tickets_number (number),
    KEY support_tickets_business_status_last (business_id, status, last_message_at),
    KEY support_tickets_opened_by_created (opened_by_member_id, created_at),
    KEY support_tickets_status_waiting (status, waiting_since),
    KEY support_tickets_assignee_status (assignee_member_id, status),
    KEY support_tickets_created_at (created_at),
    KEY support_tickets_run_id (run_id),
    CONSTRAINT support_tickets_business_fk FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE,
    CONSTRAINT support_tickets_opened_by_fk FOREIGN KEY (opened_by_member_id) REFERENCES members (id),
    CONSTRAINT support_tickets_assignee_fk FOREIGN KEY (assignee_member_id) REFERENCES members (id)
  ) ${OPTIONS} AUTO_INCREMENT=1001`,
  `CREATE TABLE support_messages (
    id CHAR(36) NOT NULL,
    ticket_id CHAR(36) NOT NULL,
    kind ENUM('customer_reply','staff_reply','internal_note','event') NOT NULL,
    author_member_id CHAR(36) NULL,
    body TEXT NULL COMMENT 'plain text, at most 10,000 characters (checked by the app)',
    event JSON NULL COMMENT '{ type, from?, to?, assigneeId? } for kind = event',
    emailed TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY support_messages_ticket_created (ticket_id, created_at),
    KEY support_messages_author_created (author_member_id, created_at),
    CONSTRAINT support_messages_ticket_fk FOREIGN KEY (ticket_id) REFERENCES support_tickets (id) ON DELETE CASCADE,
    CONSTRAINT support_messages_author_fk FOREIGN KEY (author_member_id) REFERENCES members (id)
  ) ${OPTIONS}`,
  `CREATE TABLE support_ticket_views (
    ticket_id CHAR(36) NOT NULL,
    member_id CHAR(36) NOT NULL,
    last_viewed_at DATETIME(3) NOT NULL,
    PRIMARY KEY (ticket_id, member_id),
    KEY support_ticket_views_member_id (member_id),
    CONSTRAINT support_ticket_views_ticket_fk FOREIGN KEY (ticket_id) REFERENCES support_tickets (id) ON DELETE CASCADE,
    CONSTRAINT support_ticket_views_member_fk FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
  ) ${OPTIONS}`,
];

const tables = ['support_ticket_views', 'support_messages', 'support_tickets'];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of statements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of tables) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
