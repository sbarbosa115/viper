import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import type {
  AuditRecorder,
  BillingReadModel,
  BillingUnitOfWork,
  BusinessDirectory,
  PaymentGateway,
  TrialCreditsSetting,
} from './ports.js';
import { FulfilPurchase, HandleStripeWebhook, StartCheckout } from './purchases.js';
import { ReservationCommands } from './reservations.js';
import { AdjustCredits, ManageCreditPacks } from './staff.js';
import { GrantTrialCredits } from './trial-credits.js';
import { WalletQueries } from './wallet-queries.js';

export interface BillingApplicationDeps {
  uow: BillingUnitOfWork;
  readModel: BillingReadModel;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  gateway: PaymentGateway;
  audit: AuditRecorder;
  businesses: BusinessDirectory;
  trialCredits: TrialCreditsSetting;
  appUrl: string;
}

/** Builds every billing use case from its ports. */
export function createBillingApplication(deps: BillingApplicationDeps) {
  const fulfilPurchase = new FulfilPurchase(deps);
  return {
    reservations: new ReservationCommands(deps),
    queries: new WalletQueries(deps),
    grantTrialCredits: new GrantTrialCredits(deps),
    adjustCredits: new AdjustCredits(deps),
    creditPacks: new ManageCreditPacks(deps),
    startCheckout: new StartCheckout(deps),
    fulfilPurchase,
    handleStripeWebhook: new HandleStripeWebhook({ gateway: deps.gateway, fulfilPurchase }),
  };
}

export type BillingApplication = ReturnType<typeof createBillingApplication>;
