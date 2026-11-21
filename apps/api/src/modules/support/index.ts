import type { FastifyInstance } from 'fastify';
import type { Database } from '../../shared/infrastructure/db/database.js';
import type { OutboxSubscription } from '../../shared/infrastructure/outbox/index.js';

export type { SupportTables } from './infrastructure/tables.js';
export type {
  AnalyticsTracker,
  BillingForSupport,
  BusinessName,
  IdentityForSupport,
  MemberSummary,
  ResearchForSupport,
  StaffMemberSummary,
  StaffRecipient,
  SupportAudit,
  SupportAuditAction,
  SupportAuditRecord,
  SupportEventPublisher,
  SupportEventType,
  SupportOutboxEvents,
  SupportRun,
  TicketEventBase,
} from './ports.js';
export { SUPPORT_EVENT_TYPES } from './ports.js';

/** The HTTP module's shape (matches app.ts AppModule). */
export interface SupportHttpModule {
  readonly name: 'support';
  register(app: FastifyInstance): void;
}

/**
 * support: Tickets between Members and Staff (prd-support, ADR 0021). Skeleton from WP-0: no
 * routes yet; the customer and Staff endpoints, the domain and the email worker land in Wave 1.
 */
export const supportModule: SupportHttpModule = {
  name: 'support',
  register: () => undefined,
};

/**
 * Outbox events this module consumes (`TicketOpened`, `CustomerReplied`, `StaffReplied`,
 * `TicketClosed` on the `support` queue, FR-11). Empty until the email worker lands.
 */
export const supportSubscriptions: readonly OutboxSubscription[] = [];

/** Fixed ids the seed shares across modules (scripts/seed.ts `demo`). */
interface DemoIds {
  businesses: { sweetSupply: string; cleanDesk: string };
  members: { owner: string; newOwner: string; staff: string };
  runs: Record<string, string>;
}

/**
 * Demo data (prd-support section 8a), called by scripts/seed.ts after leads. Never in production.
 * A no-op until the support seed lands (Jo Kim, the failed run and Tickets #1001 to #1005).
 */
export function seed(_deps: { db: Database; demo: DemoIds }): Promise<void> {
  return Promise.resolve();
}
