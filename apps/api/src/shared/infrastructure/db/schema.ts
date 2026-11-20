/* eslint-disable boundaries/dependencies -- schema.ts is the one place that composes every module's table types (architecture.md section 1). Type-only imports. */
import type { ColumnType } from 'kysely';
import type { AssistantTables } from '../../../modules/assistant/infrastructure/tables.js';
import type { BillingTables } from '../../../modules/billing/infrastructure/tables.js';
import type { IdentityTables } from '../../../modules/identity/infrastructure/tables.js';
import type { LeadsTables } from '../../../modules/leads/infrastructure/tables.js';
import type { PlanningTables } from '../../../modules/planning/infrastructure/tables.js';
import type { PlatformTables } from '../../../modules/platform/infrastructure/tables.js';
import type { ProfileTables } from '../../../modules/profile/infrastructure/tables.js';
import type { ResearchTables } from '../../../modules/research/infrastructure/tables.js';
import type { ToolsTables } from '../../../modules/tools/infrastructure/tables.js';
import type { OutboxTables } from '../outbox/table.js';

// Column helpers, matching how mysql2 (see database.ts) reads and writes MySQL types --------------

/** DATETIME(3), UTC. Read as a Date; written as a Date (or an ISO string). */
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

/** JSON. mysql2 returns it parsed; writes must be `JSON.stringify(value)`. */
export type Json<T> = ColumnType<T, string, string>;

/** TINYINT(1). Read as 0 or 1; written as a boolean or 0/1. */
export type Bool = ColumnType<number, boolean | number, boolean | number>;

/**
 * TINYINT(1) with a database default, so inserts may omit it. Use this instead of
 * `Generated<Bool>`: Kysely does not unwrap a ColumnType nested inside Generated, so selects
 * would be typed as the ColumnType object rather than a number.
 */
export type DefaultedBool = ColumnType<number, boolean | number | undefined, boolean | number>;

/** DECIMAL, read as a number (`decimalNumbers: true`). BIGINT is a number too (safe below 2^53). */
export type Decimal = number;

/** The Kysely database interface: every module's tables plus the shared outbox. */
export interface DB
  extends
    IdentityTables,
    PlatformTables,
    OutboxTables,
    BillingTables,
    ProfileTables,
    AssistantTables,
    PlanningTables,
    ResearchTables,
    ToolsTables,
    LeadsTables {}
