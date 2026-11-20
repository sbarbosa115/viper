import { sql, type Kysely } from 'kysely';

/** leads: Sources, Prospects, Leads, Contacts and Evidence (PRD section 8). */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const statements = [
  `CREATE TABLE sources (
    id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    url VARCHAR(2048) NULL,
    retrieved_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id)
  ) ${OPTIONS}`,
  `CREATE TABLE prospects (
    id CHAR(36) NOT NULL,
    run_id CHAR(36) NOT NULL,
    business_id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(500) NULL,
    lat DECIMAL(9,6) NULL,
    lng DECIMAL(9,6) NULL,
    category VARCHAR(120) NULL,
    phone_normalised VARCHAR(32) NULL,
    domain VARCHAR(255) NULL,
    place_keys JSON NOT NULL COMMENT 'e.g. ["google:ChIJ…","osm:node/123"]',
    pre_score INT NULL,
    data JSON NOT NULL COMMENT 'collected facts, contacts and evidence with their Sources',
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY prospects_run_created (run_id, created_at),
    KEY prospects_business_id (business_id),
    KEY prospects_run_phone (run_id, phone_normalised),
    KEY prospects_run_domain (run_id, domain),
    KEY prospects_run_pre_score (run_id, pre_score)
  ) ${OPTIONS}`,
  `CREATE TABLE leads (
    id CHAR(36) NOT NULL,
    business_id CHAR(36) NOT NULL,
    plan_id CHAR(36) NOT NULL,
    run_id CHAR(36) NOT NULL,
    prospect_id CHAR(36) NOT NULL,
    place_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(120) NULL,
    address VARCHAR(500) NULL,
    distance_miles DECIMAL(6,2) NULL,
    fit_score INT NOT NULL,
    pitch_product_id CHAR(36) NULL,
    pitch_product_name VARCHAR(120) NOT NULL COMMENT 'snapshot, so the Lead reads without profile',
    pitch_reason VARCHAR(500) NOT NULL,
    feedback ENUM('good','not_fit') NULL,
    feedback_reason VARCHAR(200) NULL,
    feedback_at DATETIME(3) NULL,
    removed_at DATETIME(3) NULL,
    delivered_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY leads_plan_place_key (plan_id, place_key),
    KEY leads_business_delivered (business_id, delivered_at),
    KEY leads_run_id (run_id),
    KEY leads_prospect_id (prospect_id),
    KEY leads_pitch_product_id (pitch_product_id),
    KEY leads_plan_fit_score (plan_id, fit_score),
    KEY leads_plan_distance (plan_id, distance_miles),
    KEY leads_plan_delivered (plan_id, delivered_at),
    KEY leads_plan_feedback (plan_id, feedback),
    KEY leads_feedback_at (feedback_at),
    KEY leads_delivered_at (delivered_at),
    CONSTRAINT leads_prospect_fk FOREIGN KEY (prospect_id) REFERENCES prospects (id)
  ) ${OPTIONS}`,
  `CREATE TABLE lead_contacts (
    id CHAR(36) NOT NULL,
    lead_id CHAR(36) NOT NULL,
    type ENUM('phone','email','website','instagram','tiktok','yelp','facebook') NOT NULL,
    value VARCHAR(2048) NOT NULL,
    label VARCHAR(120) NULL,
    verification ENUM('verified','unverified') NOT NULL,
    source_id CHAR(36) NOT NULL,
    PRIMARY KEY (id),
    KEY lead_contacts_lead_type (lead_id, type),
    KEY lead_contacts_source_id (source_id),
    KEY lead_contacts_type_verification (type, verification),
    CONSTRAINT lead_contacts_lead_fk FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE,
    CONSTRAINT lead_contacts_source_fk FOREIGN KEY (source_id) REFERENCES sources (id)
  ) ${OPTIONS}`,
  `CREATE TABLE lead_evidence (
    id CHAR(36) NOT NULL,
    lead_id CHAR(36) NOT NULL,
    fact VARCHAR(300) NOT NULL,
    points INT NOT NULL,
    source_id CHAR(36) NOT NULL,
    position INT NOT NULL,
    PRIMARY KEY (id),
    KEY lead_evidence_lead_position (lead_id, position),
    KEY lead_evidence_source_id (source_id),
    CONSTRAINT lead_evidence_lead_fk FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE,
    CONSTRAINT lead_evidence_source_fk FOREIGN KEY (source_id) REFERENCES sources (id)
  ) ${OPTIONS}`,
];

const tables = ['lead_evidence', 'lead_contacts', 'leads', 'prospects', 'sources'];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of statements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of tables) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
