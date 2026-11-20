import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { createBillingApplication } from '../application/billing.js';
import { FakePaymentGateway } from '../infrastructure/fake-payment-gateway.js';
import {
  FixedTrialCredits,
  InMemoryBilling,
  RecordingAuditRecorder,
  StaticBusinessDirectory,
} from '../infrastructure/in-memory-billing.js';

export const BUSINESS = '00000000-0000-7000-8000-00000000b001';
export const OTHER_BUSINESS = '00000000-0000-7000-8000-00000000b002';
export const RUN = '00000000-0000-7000-8000-00000000a001';
export const OWNER_ID = '00000000-0000-7000-8000-00000000c001';
export const STAFF_ID = '00000000-0000-7000-8000-00000000c002';
export const APP_URL = 'http://localhost:5173';

export function owner(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: OWNER_ID,
    businessId: BUSINESS,
    roles: ['owner'],
    emailVerified: true,
    ...overrides,
  };
}

/** Staff signed in with two-factor, on their own internal Business. */
export function staff(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: STAFF_ID,
    businessId: '00000000-0000-7000-8000-00000000b0ff',
    roles: ['owner', 'staff'],
    emailVerified: true,
    ...overrides,
  };
}

/** Staff Acting as BUSINESS (FR-6). */
export function actingAs(): Actor {
  return staff({
    businessId: BUSINESS,
    actingAs: { businessId: BUSINESS, businessName: 'Sweet Supply Co', staffMemberId: STAFF_ID },
  });
}

/** The billing use cases on in-memory storage and fakes. */
export function billingFixture(options: { trialCredits?: number } = {}) {
  const store = new InMemoryBilling();
  const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
  const ids = new SequentialIdGenerator();
  const analytics = new RecordingAnalyticsTracker();
  const gateway = new FakePaymentGateway(ids, APP_URL);
  const audit = new RecordingAuditRecorder();
  const app = createBillingApplication({
    uow: store,
    readModel: store,
    clock,
    ids,
    analytics,
    gateway,
    audit,
    businesses: new StaticBusinessDirectory([BUSINESS, OTHER_BUSINESS]),
    trialCredits: new FixedTrialCredits(options.trialCredits ?? 50),
    appUrl: APP_URL,
  });

  /** Moves the clock on, so entries have distinct times. */
  const tick = (seconds = 1) => clock.set(new Date(clock.now().getTime() + seconds * 1000));

  /** Grants credits to a Business as a Staff adjustment. */
  const fund = (credits: number, businessId = BUSINESS) => {
    tick();
    return app.adjustCredits.apply({
      businessId,
      credits,
      reason: 'Beta credit',
      memberId: STAFF_ID,
    });
  };

  return { app, store, clock, ids, analytics, gateway, audit, tick, fund };
}
