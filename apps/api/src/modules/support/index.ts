import type { FastifyInstance } from 'fastify';
import type { Database } from '../../shared/infrastructure/db/database.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import { KyselyOutbox } from '../../shared/infrastructure/outbox/index.js';
import { createCustomerSupport } from './application/customer/index.js';
import { createStaffSupport } from './application/staff/index.js';
import type { SupportStore } from './domain/index.js';
import { customerSupportRoutes } from './http/customer.routes.js';
import { staffSupportRoutes } from './http/staff.routes.js';
import { supportTestRoutes } from './http/test-hooks.routes.js';
import { KyselySupportStore } from './infrastructure/kysely-support.js';
import type {
  AnalyticsTracker,
  BillingForSupport,
  IdentityForSupport,
  ResearchForSupport,
  SupportAudit,
} from './ports.js';

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

/** What support needs from the composition root (prd-support section 7, module ports). */
export interface SupportDeps {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  identity: IdentityForSupport;
  research: ResearchForSupport;
  billing: BillingForSupport;
  audit: SupportAudit;
  analytics: AnalyticsTracker;
  /** NODE_ENV when test hooks are enabled; the hooks register only for `test`. */
  testHooksEnv: string | null;
  /** The Business's Owner, for the fill-open test hook. */
  ownerOf(businessId: string): Promise<string | null>;
}

export interface Support {
  module: SupportHttpModule;
  store: SupportStore;
}

/**
 * support: Tickets between Members and Staff (prd-support, ADR 0021). Customer endpoints under
 * /api/support, Staff endpoints under /api/staff/support, test hooks under /api/test/support.
 */
export function createSupport(deps: SupportDeps): Support {
  const { db, clock, ids, identity, research, billing, audit, analytics } = deps;
  const store = new KyselySupportStore(db, new KyselyOutbox(ids, clock));
  const customer = createCustomerSupport({
    store,
    identity,
    research,
    billing,
    analytics,
    clock,
    ids,
  });
  const staff = createStaffSupport({
    store,
    identity,
    research,
    billing,
    audit,
    analytics,
    clock,
    ids,
  });
  const testRoutes = supportTestRoutes({
    nodeEnv: deps.testHooksEnv ?? 'production',
    store,
    identity,
    ownerOf: (businessId) => deps.ownerOf(businessId),
    clock,
    ids,
  });
  return {
    store,
    module: {
      name: 'support',
      register: (app) => {
        customerSupportRoutes(app, customer);
        staffSupportRoutes(staff)(app);
        testRoutes(app);
      },
    },
  };
}

export {
  supportSubscriptions,
  registerSupportWorkers,
  SUPPORT_QUEUE,
} from './email/support-worker.js';
export type { SupportWorkerDeps } from './email/support-worker.js';
export { seed } from './seed.js';
