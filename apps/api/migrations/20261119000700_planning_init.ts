import { sql, type Kysely } from 'kysely';

/** planning: Plans and Target segments (PRD section 8). */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const statements = [
  `CREATE TABLE plans (
    id CHAR(36) NOT NULL,
    business_id CHAR(36) NOT NULL,
    flow_key VARCHAR(64) NOT NULL DEFAULT 'local-buyers' COMMENT 'the Research flow the Plan runs',
    name VARCHAR(60) NOT NULL,
    goal VARCHAR(500) NOT NULL,
    search_label VARCHAR(200) NOT NULL,
    lat DECIMAL(9,6) NOT NULL,
    lng DECIMAL(9,6) NOT NULL,
    radius_miles DECIMAL(4,1) NOT NULL,
    max_credits INT NOT NULL,
    max_leads INT NOT NULL,
    min_fit_score INT NOT NULL,
    icp_edited_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY plans_business_created (business_id, created_at),
    KEY plans_flow_key (flow_key),
    KEY plans_icp_edited_at (icp_edited_at)
  ) ${OPTIONS}`,
  `CREATE TABLE target_segments (
    id CHAR(36) NOT NULL,
    plan_id CHAR(36) NOT NULL,
    name VARCHAR(60) NOT NULL,
    fit_signals JSON NOT NULL,
    exclusions JSON NOT NULL,
    product_id CHAR(36) NOT NULL,
    position INT NOT NULL,
    PRIMARY KEY (id),
    KEY target_segments_plan_position (plan_id, position),
    KEY target_segments_product_id (product_id),
    CONSTRAINT target_segments_plan_fk FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE CASCADE
  ) ${OPTIONS}`,
];

const tables = ['target_segments', 'plans'];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of statements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of tables) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
