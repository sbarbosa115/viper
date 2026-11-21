import { Worker, type Job } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { AnalyticsTracker } from '../../shared/application/analytics-tracker.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import {
  KyselyOutbox,
  type OutboxMessage,
  type OutboxSubscription,
} from '../../shared/infrastructure/outbox/index.js';
import { SystemClock } from '../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../shared/infrastructure/time/uuid7.js';
import { createBillingApplication, type BillingApplication } from './application/billing.js';
import type {
  AuditRecorder,
  BillingReadModel,
  BillingUnitOfWork,
  BusinessDirectory,
  PaymentGateway,
  StripeSettings,
  TrialCreditsSetting,
} from './application/ports.js';
import { ReservationCommands } from './application/reservations.js';
import { AdjustCredits, ManageCreditPacks } from './application/staff.js';
import { GrantTrialCredits } from './application/trial-credits.js';
import type { WalletQueries } from './application/wallet-queries.js';
import { Purchase } from './domain/purchase.js';
import { FakePaymentGateway } from './infrastructure/fake-payment-gateway.js';
import {
  AnyBusinessDirectory,
  FixedTrialCredits,
  InMemoryBilling,
  RecordingAuditRecorder,
} from './infrastructure/in-memory-billing.js';
import { KyselyBillingReadModel } from './infrastructure/kysely-billing-read-model.js';
import { KyselyBillingUnitOfWork } from './infrastructure/kysely-billing.js';
import { StripePaymentGateway } from './infrastructure/stripe-payment-gateway.js';
import { billingRoutes } from './http/billing.routes.js';

export type {
  AuditRecorder,
  BusinessDirectory,
  PaymentGateway,
  StripeSettings,
  TrialCreditsSetting,
} from './application/ports.js';
export type { ReservationView } from './application/reservations.js';
export type { SettlementResult } from './domain/reservation.js';
export type { WalletView } from './application/wallet-queries.js';
export {
  chargeableCredits,
  creditsFromMillicredits,
  type RunOutcome,
} from './domain/settlement.js';
export { FakePaymentGateway } from './infrastructure/fake-payment-gateway.js';

/**
 * What research calls (FR-18, FR-20, FR-36). Each command is idempotent per run id and accepts
 * the caller's open Kysely transaction as `within`, so a run and its Reservation commit together.
 * - `reserve({ businessId, runId, credits })`: throws CodedError INSUFFICIENT_CREDITS
 *   `{ available, required }`.
 * - `topUpReservation({ runId, credits })`: holds more for a resume (reopens a closed one).
 * - `settle({ runId, creditsSpent, planName? })`: `creditsSpent` is the run's total chargeable
 *   credits (use `chargeableCredits`); charges what's not charged yet, releases the rest, closes.
 * - `release({ runId })`: gives the hold back without charging.
 */
export type BillingCommands = Pick<
  ReservationCommands,
  'reserve' | 'topUpReservation' | 'settle' | 'release'
>;

/** Reads for other modules: the header balance, run start checks and Staff reporting. */
export type BillingQueries = Pick<
  WalletQueries,
  'getWallet' | 'activePacks' | 'creditsSummary' | 'availableByBusiness' | 'payingBusinessIds'
>;

/** The HTTP module's shape (matches app.ts AppModule). */
export interface BillingHttpModule {
  readonly name: 'billing';
  register(app: FastifyInstance): Promise<void>;
}

export interface Billing {
  module: BillingHttpModule;
  billingCommands: BillingCommands;
  billingQueries: BillingQueries;
  /** Every use case (seed, workers, tests). */
  application: BillingApplication;
}

interface CommonDeps {
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  gateway: PaymentGateway;
  audit: AuditRecorder;
  /** identity's answer to "does this Business exist" (404 on Staff grants). */
  businesses?: BusinessDirectory;
  /** platform's ceilings.trialCredits; 50 when absent. */
  trialCredits?: TrialCreditsSetting;
  /** APP_URL, for the Checkout success and cancel URLs. */
  appUrl: string;
  /** ENABLE_TEST_HOOKS=1 and NODE_ENV != production: adds POST /api/test/stripe/complete/:id. */
  testHooks?: boolean;
}

function assemble(uow: BillingUnitOfWork, readModel: BillingReadModel, deps: CommonDeps): Billing {
  const application = createBillingApplication({
    ...deps,
    uow,
    readModel,
    businesses: deps.businesses ?? new AnyBusinessDirectory(),
    trialCredits: deps.trialCredits ?? new FixedTrialCredits(),
  });
  const r = application.reservations;
  const q = application.queries;
  return {
    application,
    billingCommands: {
      reserve: r.reserve.bind(r),
      topUpReservation: r.topUpReservation.bind(r),
      settle: r.settle.bind(r),
      release: r.release.bind(r),
    },
    billingQueries: {
      getWallet: q.getWallet.bind(q),
      activePacks: q.activePacks.bind(q),
      creditsSummary: q.creditsSummary.bind(q),
      availableByBusiness: q.availableByBusiness.bind(q),
      payingBusinessIds: q.payingBusinessIds.bind(q),
    },
    module: {
      name: 'billing',
      register: (app) =>
        billingRoutes(app, { billing: application, testHooks: deps.testHooks ?? false }),
    },
  };
}

/** billing: Credit wallet, ledger, Reservations, Credit packs and Stripe purchases (FR-10 to FR-13). */
export function createBilling(deps: CommonDeps & { db: Database }): Billing {
  const uow = kyselyUnitOfWork(deps.db, deps.clock, deps.ids, deps.audit);
  return assemble(uow, new KyselyBillingReadModel(deps.db), deps);
}

function kyselyUnitOfWork(
  db: Database,
  clock: Clock,
  ids: IdGenerator,
  audit: AuditRecorder,
): BillingUnitOfWork {
  return new KyselyBillingUnitOfWork(db, clock, new KyselyOutbox(ids, clock), audit);
}

/**
 * The same module on in-memory storage with a fake payment gateway, for other modules' tests
 * (research's run start and Settlement).
 */
export function createInMemoryBilling(
  deps: Partial<CommonDeps> & Pick<CommonDeps, 'clock' | 'ids'>,
): Billing & {
  store: InMemoryBilling;
  gateway: FakePaymentGateway;
  audit: RecordingAuditRecorder;
} {
  const audit = new RecordingAuditRecorder();
  const store = new InMemoryBilling(deps.audit ?? audit);
  const gateway = new FakePaymentGateway(deps.ids, deps.appUrl ?? 'http://localhost:5173');
  const billing = assemble(store, store, {
    analytics: { track: () => Promise.resolve() },
    appUrl: 'http://localhost:5173',
    gateway,
    audit,
    ...deps,
  });
  return { ...billing, store, gateway, audit };
}

/** Stripe in production; the fake (Checkout = the app's own credits page) in dev, test and e2e. */
export function createPaymentGateway(deps: {
  fake: boolean;
  settings: StripeSettings;
  ids: IdGenerator;
  appUrl: string;
}): PaymentGateway {
  return deps.fake
    ? new FakePaymentGateway(deps.ids, deps.appUrl)
    : new StripePaymentGateway(deps.settings);
}

/**
 * Placeholder kept so app.ts compiles until main.ts registers `createBilling(...).module`
 * instead (it has no routes).
 */
export const billingModule = {
  name: 'billing',
  register(_app: FastifyInstance): void {
    // Replaced by createBilling(...).module in the composition root.
  },
};

/** Fixed ids the seed shares across modules (scripts/seed.ts `demo`). */
interface DemoIds {
  businesses: { sweetSupply: string; cleanDesk: string; cornerCoffee: string };
  members: { staff: string };
  runs: { bakeriesNearAustin: string };
}

export const DEMO_PACKS = [
  { name: 'Starter', credits: 2_500, priceCents: 2_500, active: true },
  { name: 'Growth', credits: 11_000, priceCents: 10_000, active: true },
  { name: 'Pro', credits: 30_000, priceCents: 25_000, active: true },
] as const;

const BETA_REASON = 'Beta credit from Llyner';

/**
 * prd-expenses section 8a: paid purchases in November 2026 (revenue $197.00, no tax). Purchase
 * history only: no ledger entries, so the demo wallets above stay as documented.
 */
const NOVEMBER_PURCHASES = [
  { key: 'nov-1', business: 'sweetSupply', amountCents: 4_900, paidAt: '2026-11-06T15:20:00.000Z' },
  {
    key: 'nov-2',
    business: 'cornerCoffee',
    amountCents: 4_900,
    paidAt: '2026-11-10T11:05:00.000Z',
  },
  { key: 'nov-3', business: 'sweetSupply', amountCents: 9_900, paidAt: '2026-11-15T17:45:00.000Z' },
] as const;

/**
 * Demo data (PRD section 8a), idempotent. Credit packs Starter, Growth, Pro; wallets: Sweet
 * Supply Co 863 available (+50 trial, +950 "Beta credit from Llyner", −137 for the demo run of
 * "Bakeries near Austin"), Clean Desk Co 50 (trial), Corner Coffee Roasters 120 (+50 trial, +70).
 * Three paid November 2026 purchases ($49, $49, $99) for the finance P&L (prd-expenses 8a).
 */
export async function seed(deps: {
  db: Database;
  clock?: Clock;
  ids?: IdGenerator;
  demo: DemoIds;
}): Promise<void> {
  const clock = deps.clock ?? new SystemClock();
  const ids = deps.ids ?? new Uuid7Generator();
  const uow = kyselyUnitOfWork(deps.db, clock, ids, new RecordingAuditRecorder());
  const system = { uow, clock, ids };
  const { businesses, members, runs } = deps.demo;

  const packs = new ManageCreditPacks(system);
  let starterPackId = '';
  for (const pack of DEMO_PACKS) {
    const view = await packs.ensure(pack);
    if (pack.name === 'Starter') starterPackId = view.id;
  }

  const trial = new GrantTrialCredits({ ...system, trialCredits: new FixedTrialCredits(50) });
  for (const businessId of [
    businesses.sweetSupply,
    businesses.cleanDesk,
    businesses.cornerCoffee,
  ]) {
    await trial.execute({ businessId });
  }
  const adjust = new AdjustCredits({ ...system, businesses: new AnyBusinessDirectory() });
  const beta = (businessId: string, credits: number) =>
    adjust.apply({
      businessId,
      credits,
      reason: BETA_REASON,
      memberId: members.staff,
      idempotencyKey: `seed:beta:${businessId}`,
    });
  await beta(businesses.sweetSupply, 950);
  await beta(businesses.cornerCoffee, 70);

  const reservations = new ReservationCommands(system);
  const runId = runs.bakeriesNearAustin;
  await reservations.reserve({ businessId: businesses.sweetSupply, runId, credits: 400 });
  await reservations.settle({ runId, creditsSpent: 137, planName: 'Bakeries near Austin' });

  for (const p of NOVEMBER_PURCHASES) {
    const sessionId = `cs_seed_${p.key}`;
    await uow.run(async ({ purchases }) => {
      if (await purchases.findBySessionIdForUpdate(sessionId)) return;
      const paidAt = new Date(p.paidAt);
      const purchase = Purchase.start({
        id: ids.next(),
        businessId: businesses[p.business],
        packId: starterPackId,
        credits: p.amountCents,
        amountCents: p.amountCents,
        stripeSessionId: sessionId,
        now: new Date(paidAt.getTime() - 60_000),
      });
      purchase.markPaid({ eventId: `evt_seed_${p.key}`, taxCents: 0, now: paidAt });
      await purchases.save(purchase);
    });
  }
}

export const BILLING_QUEUE = 'billing';

/** Outbox events this module consumes, routed to its queues by the relay. */
export const billingSubscriptions: readonly OutboxSubscription[] = [
  { event: 'MemberEmailVerified', queue: BILLING_QUEUE },
];

/** Handles one outbox event delivered to the billing queue (FR-11 trial credits). */
export async function handleBillingEvent(
  message: OutboxMessage,
  app: Pick<BillingApplication, 'grantTrialCredits'>,
): Promise<void> {
  if (message.type === 'MemberEmailVerified') {
    const payload = message.payload as OutboxMessage<'MemberEmailVerified'>['payload'];
    await app.grantTrialCredits.execute({ businessId: payload.businessId });
  }
}

/** This module's BullMQ workers, started by worker-registry.ts. */
export function registerBillingWorkers(deps: {
  db: Database;
  connection: Redis;
  logger: Logger;
  trialCredits?: TrialCreditsSetting;
  /** Queue key prefix (tests isolate themselves with one). */
  prefix?: string;
}): Worker[] {
  const clock = new SystemClock();
  const ids = new Uuid7Generator();
  const grantTrialCredits = new GrantTrialCredits({
    uow: kyselyUnitOfWork(deps.db, clock, ids, new RecordingAuditRecorder()),
    clock,
    ids,
    trialCredits: deps.trialCredits ?? new FixedTrialCredits(),
  });
  const worker = new Worker<OutboxMessage>(
    BILLING_QUEUE,
    (job: Job<OutboxMessage>) => handleBillingEvent(job.data, { grantTrialCredits }),
    { connection: deps.connection, ...(deps.prefix ? { prefix: deps.prefix } : {}) },
  );
  worker.on('failed', (job, err) =>
    deps.logger.warn({ err, jobId: job?.id, attempts: job?.attemptsMade }, 'billing job failed'),
  );
  return [worker];
}
