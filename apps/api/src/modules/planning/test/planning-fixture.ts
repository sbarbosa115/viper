import type { RunSummary } from '@app/contracts/research';
import {
  LlmUnavailableError,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
} from '../../../shared/application/llm-client.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { FixtureGeocoder } from '../../../shared/infrastructure/geo/fixture-geocoder.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { DRAFT_PLAN_TOOL, LlmPlanDrafter } from '../infrastructure/llm-plan-drafter.js';
import { createPlanningApplication } from '../application/planning.js';
import type {
  PlanActivity,
  ProfileReader,
  ProfileView,
  RunStats,
  WalletReader,
} from '../application/ports.js';
import { StaticFlowDefaults } from '../infrastructure/defaults.js';
import { InMemoryPlans } from '../infrastructure/in-memory-plans.js';

export const BUSINESS = '00000000-0000-7000-8000-00000000b001';
export const OTHER_BUSINESS = '00000000-0000-7000-8000-00000000b002';
export const OWNER_ID = '00000000-0000-7000-8000-00000000c001';
export const OTHER_OWNER_ID = '00000000-0000-7000-8000-00000000c003';
export const STAFF_ID = '00000000-0000-7000-8000-00000000c002';
export const CANE_SUGAR = '00000000-0000-7000-8000-00000000d201';
export const POWDERED_SUGAR = '00000000-0000-7000-8000-00000000d202';
export const UNKNOWN_ID = '00000000-0000-7000-8000-00000000ffff';

/** Sweet Supply Co's profile point (the FixtureGeocoder's 1200 E 6th St). */
export const SWEET_SUPPLY_LOCATION = {
  label: '1200 E 6th St, Austin, TX 78702',
  lat: 30.2624,
  lng: -97.7262,
};

export function sweetSupplyProfile(overrides: Partial<ProfileView> = {}): ProfileView {
  return {
    complete: true,
    location: SWEET_SUPPLY_LOCATION,
    deliveryRadiusMiles: 10,
    products: [
      { id: CANE_SUGAR, name: 'Cane sugar, 50 lb bag', description: 'Fine granulated' },
      { id: POWDERED_SUGAR, name: 'Powdered sugar, 25 lb', description: '' },
    ],
    ...overrides,
  };
}

export function owner(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: OWNER_ID,
    businessId: BUSINESS,
    roles: ['owner'],
    emailVerified: true,
    ...overrides,
  };
}

export function otherOwner(): Actor {
  return owner({ memberId: OTHER_OWNER_ID, businessId: OTHER_BUSINESS });
}

/** Staff Acting as BUSINESS (FR-6). */
export function actingAs(): Actor {
  return owner({
    memberId: STAFF_ID,
    roles: ['owner', 'staff'],
    actingAs: { businessId: BUSINESS, businessName: 'Sweet Supply Co', staffMemberId: STAFF_ID },
  });
}

export class FakeProfiles implements ProfileReader {
  readonly profiles = new Map<string, ProfileView>([
    [BUSINESS, sweetSupplyProfile()],
    [OTHER_BUSINESS, sweetSupplyProfile()],
  ]);
  getProfile(businessId: string): Promise<ProfileView | null> {
    return Promise.resolve(this.profiles.get(businessId) ?? null);
  }
}

export class FakeWallet implements WalletReader {
  readonly balances = new Map<string, number>([
    [BUSINESS, 863],
    [OTHER_BUSINESS, 863],
  ]);
  available(businessId: string): Promise<number> {
    return Promise.resolve(this.balances.get(businessId) ?? 0);
  }
}

export class FakeRunStats implements RunStats {
  typical: number | null = null;
  readonly asked: string[] = [];
  typicalCredits(flowKey: string): Promise<number | null> {
    this.asked.push(flowKey);
    return Promise.resolve(this.typical);
  }
}

export class FakePlanActivity implements PlanActivity {
  readonly runs = new Map<string, RunSummary>();
  readonly leads = new Map<string, number>();
  lastRuns(
    _businessId: string,
    planIds: readonly string[],
  ): Promise<ReadonlyMap<string, RunSummary>> {
    return Promise.resolve(new Map([...this.runs].filter(([id]) => planIds.includes(id))));
  }
  leadsCounts(
    _businessId: string,
    planIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    return Promise.resolve(new Map([...this.leads].filter(([id]) => planIds.includes(id))));
  }
}

/** Minimal scripted LlmClient: returns queued responses (or throws queued errors) in order. */
export class ScriptedLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private readonly queue: (LlmResponse | Error)[] = [];

  reply(...responses: (LlmResponse | Error)[]): this {
    this.queue.push(...responses);
    return this;
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const next = this.queue.shift() ?? new LlmUnavailableError('No scripted response left');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

export interface DraftInput {
  name: string;
  segments: { name: string; fitSignals: string[]; exclusions: string[]; productId: string }[];
  place: string | null;
  radiusMiles: number | null;
}

/** A planning-model reply calling the draft_plan tool. */
export function draftReply(input: DraftInput): LlmResponse {
  return {
    text: '',
    toolCall: { name: DRAFT_PLAN_TOOL, input },
    usage: { inputTokens: 500, outputTokens: 200 },
    model: 'scripted',
  };
}

/** The scripted draft for "bakeries within 3 miles that could buy our sugar" (FR-16). */
export function bakeriesDraft(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    name: 'Bakeries near Austin',
    segments: [
      {
        name: 'Bakeries',
        fitSignals: ['Bakes on site', 'Sells bread or pastries daily'],
        exclusions: ['Chain bakeries'],
        productId: CANE_SUGAR,
      },
    ],
    place: null,
    radiusMiles: 3,
    ...overrides,
  };
}

export const BAKERIES_GOAL = 'bakeries within 3 miles that could buy our sugar';

/** The planning use cases on in-memory storage and fakes. */
export function planningFixture() {
  const store = new InMemoryPlans();
  const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
  const ids = new SequentialIdGenerator();
  const analytics = new RecordingAnalyticsTracker();
  const llm = new ScriptedLlm();
  const profiles = new FakeProfiles();
  const wallet = new FakeWallet();
  const runStats = new FakeRunStats();
  const activity = new FakePlanActivity();
  const flows = new StaticFlowDefaults();
  const geocoder = new FixtureGeocoder();
  const app = createPlanningApplication({
    uow: store,
    clock,
    ids,
    analytics,
    drafter: new LlmPlanDrafter(llm),
    geocoder,
    profiles,
    flows,
    runStats,
    wallet,
    activity,
  });
  const tick = (seconds = 1) => clock.set(new Date(clock.now().getTime() + seconds * 1000));

  /** Creates the bakeries Plan from the scripted draft. */
  const createBakeries = async (actor: Actor = owner(), overrides: Partial<DraftInput> = {}) => {
    llm.reply(draftReply(bakeriesDraft(overrides)));
    return app.createPlan.execute(actor, BAKERIES_GOAL);
  };

  return {
    app,
    store,
    clock,
    ids,
    analytics,
    llm,
    profiles,
    wallet,
    runStats,
    activity,
    flows,
    geocoder,
    tick,
    createBakeries,
  };
}
