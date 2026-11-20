import { sql, type Kysely } from 'kysely';

/** profile: Business Profile and Products (PRD section 8). */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const statements = [
  `CREATE TABLE business_profiles (
    business_id CHAR(36) NOT NULL,
    description VARCHAR(500) NULL,
    category VARCHAR(80) NULL,
    address_line1 VARCHAR(200) NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(50) NULL,
    postal_code VARCHAR(20) NULL,
    country CHAR(2) NOT NULL DEFAULT 'US',
    lat DECIMAL(9,6) NULL,
    lng DECIMAL(9,6) NULL,
    location_label VARCHAR(200) NULL,
    delivery_radius_miles DECIMAL(5,1) NULL,
    current_customers VARCHAR(500) NULL,
    price_range VARCHAR(120) NULL,
    website VARCHAR(2048) NULL,
    completed_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (business_id),
    KEY business_profiles_completed_at (completed_at)
  ) ${OPTIONS}`,
  `CREATE TABLE products (
    id CHAR(36) NOT NULL,
    business_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY products_business_created (business_id, created_at)
  ) ${OPTIONS}`,
];

const tables = ['products', 'business_profiles'];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of statements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of tables) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
