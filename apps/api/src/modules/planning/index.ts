import { LOCAL_BUYERS_FLOW_KEY } from '@app/contracts/research';
import type { FastifyInstance } from 'fastify';
import type { AnalyticsTracker } from '../../shared/application/analytics-tracker.js';
import type { Geocoder } from '../../shared/application/geocoder.js';
import type { LlmClient } from '../../shared/application/llm-client.js';
import type { Actor } from '../../shared/domain/actor.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import { SystemClock } from '../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../shared/infrastructure/time/uuid7.js';
import { LlmPlanDrafter } from './infrastructure/llm-plan-drafter.js';
import type { PlanForRun } from './application/plan-queries.js';
import { createPlanningApplication, type PlanningApplication } from './application/planning.js';
import type {
  FlowDefaults,
  PlanActivity,
  PlanDrafter,
  PlanningUnitOfWork,
  ProfileReader,
  RunStats,
  WalletReader,
} from './application/ports.js';
import { Guardrails } from './domain/guardrails.js';
import { Plan } from './domain/plan.js';
import { SearchArea } from './domain/search-area.js';
import { planningRoutes } from './http/planning.routes.js';
import {
  NoPlanActivity,
  NoRunStats,
  SEEDED_CEILINGS,
  SEEDED_PLAN_DEFAULTS,
  StaticFlowDefaults,
} from './infrastructure/defaults.js';
import { InMemoryPlans } from './infrastructure/in-memory-plans.js';
import { kyselyPlanningUnitOfWork } from './infrastructure/kysely-plans.js';

export type { PlanForRun } from './application/plan-queries.js';
export type {
  FlowDefaults,
  PlanActivity,
  ProfileProduct,
  ProfileReader,
  ProfileView,
  RunStats,
  WalletReader,
} from './application/ports.js';
export type { GuardrailCeilings, GuardrailValues } from './domain/guardrails.js';
export { NoPlanActivity, NoRunStats, StaticFlowDefaults } from './infrastructure/defaults.js';

/** What planning needs from the composition root. */
export interface PlanningDeps {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  /** The planning model (role `planning`); drafts Plans through the `draft_plan` tool. */
  llm: LlmClient;
  geocoder: Geocoder;
  /** profile's public queries. */
  profiles: ProfileReader;
  /** billing's available balance (`billingQueries.getWallet(id).available`). */
  wallet: WalletReader;
  /** research's flow plan defaults and limits; the seeded "Local buyers" values when absent. */
  flows?: FlowDefaults;
  /** research's typical credits; none (60% of max credits) when absent. */
  runStats?: RunStats;
  /** research's last run and leads' Lead count per Plan; none when absent. */
  activity?: PlanActivity;
}

/** What the assistant calls (FR-14: answering the Goal question creates a Plan). */
export interface PlanningCommands {
  /**
   * FR-16 for the chat. Throws CodedError PROFILE_INCOMPLETE (422) or ASSISTANT_UNAVAILABLE (503).
   * `warnings` holds "We couldn't find '<place>', so we used your address." when it applies.
   */
  draftFromGoal(actor: Actor, goal: string): Promise<{ planId: string; warnings: string[] }>;
}

/** Reads for other modules. */
export interface PlanningQueries {
  /** The Plan as the Plan screen shows it; NotFoundError outside the Actor's Business. */
  getPlan: PlanningApplication['queries']['getPlan'];
  /** For research's run start (FR-18); null when the Plan isn't the Business's. */
  getPlanSnapshot(businessId: string, planId: string): Promise<PlanForRun | null>;
  /** For profile's ProductUsage (FR-15, 409 PRODUCT_IN_USE). */
  productInUse(businessId: string, productId: string): Promise<boolean>;
}

/** The HTTP module's shape (matches app.ts AppModule). */
export interface PlanningHttpModule {
  readonly name: 'planning';
  register(app: FastifyInstance): void;
}

export interface Planning {
  module: PlanningHttpModule;
  planningCommands: PlanningCommands;
  planningQueries: PlanningQueries;
  /** Every use case (seed, tests). */
  application: PlanningApplication;
}

type CommonDeps = Omit<PlanningDeps, 'db' | 'llm'> & { drafter: PlanDrafter };

function assemble(uow: PlanningUnitOfWork, deps: CommonDeps): Planning {
  const application = createPlanningApplication({
    ...deps,
    uow,
    flows: deps.flows ?? new StaticFlowDefaults(),
    runStats: deps.runStats ?? new NoRunStats(),
    activity: deps.activity ?? new NoPlanActivity(),
  });
  const { createPlan, queries } = application;
  return {
    application,
    planningCommands: {
      async draftFromGoal(actor, goal) {
        const { plan, warnings } = await createPlan.execute(actor, goal);
        return { planId: plan.id, warnings };
      },
    },
    planningQueries: {
      getPlan: queries.getPlan.bind(queries),
      getPlanSnapshot: queries.getPlanSnapshot.bind(queries),
      productInUse: queries.productInUse.bind(queries),
    },
    module: { name: 'planning', register: (app) => planningRoutes(app, application) },
  };
}

/** planning: Plans: Goal, Ideal Customer Profile, Search area, Guardrails, estimate (FR-16, FR-17). */
export function createPlanning(deps: PlanningDeps): Planning {
  const { db, llm, ...rest } = deps;
  return assemble(kyselyPlanningUnitOfWork(db), { ...rest, drafter: new LlmPlanDrafter(llm) });
}

/** The HTTP module (routes under /api). */
export function createPlanningModule(deps: PlanningDeps): PlanningHttpModule {
  return createPlanning(deps).module;
}

export function createPlanningCommands(deps: PlanningDeps): PlanningCommands {
  return createPlanning(deps).planningCommands;
}

export function createPlanningQueries(deps: PlanningDeps): PlanningQueries {
  return createPlanning(deps).planningQueries;
}

/** The same module on in-memory storage, for other modules' tests (assistant, research, profile). */
export function createInMemoryPlanning(
  deps: Omit<PlanningDeps, 'db'>,
): Planning & { store: InMemoryPlans } {
  const store = new InMemoryPlans();
  const { llm, ...rest } = deps;
  return { ...assemble(store, { ...rest, drafter: new LlmPlanDrafter(llm) }), store };
}

/**
 * Placeholder kept so composition.ts compiles until it registers `createPlanning(...).module`
 * instead (it has no routes).
 */
export const planningModule = {
  name: 'planning',
  register(_app: FastifyInstance): void {
    // Replaced by createPlanning(...).module in the composition root.
  },
};

// Demo data -------------------------------------------------------------------------------------

/** Fixed ids the seed shares across modules (scripts/seed.ts `demo`). */
interface DemoIds {
  businesses: { sweetSupply: string; cornerCoffee: string };
  products: { caneSugar: string; espressoBeans: string };
  plans: { bakeriesNearAustin: string; cornerCafes: string };
}

/** Sweet Supply Co's address point (matches the FixtureGeocoder and profile's seed). */
export const DEMO_SWEET_SUPPLY_LOCATION = {
  label: '1200 E 6th St, Austin, TX 78702',
  lat: 30.2624,
  lng: -97.7262,
};

/** Downtown Austin, the centre of Corner Coffee Roasters' demo Plan. */
export const DEMO_DOWNTOWN_AUSTIN = { label: 'Austin, TX', lat: 30.2672, lng: -97.7431 };

function demoPlans(demo: DemoIds) {
  const sugar = demo.products.caneSugar;
  const beans = demo.products.espressoBeans;
  return [
    {
      id: demo.plans.bakeriesNearAustin,
      businessId: demo.businesses.sweetSupply,
      name: 'Bakeries near Austin',
      goal: 'Bakeries within 3 miles that could buy our cane sugar',
      area: { ...DEMO_SWEET_SUPPLY_LOCATION, radiusMiles: 3 },
      segments: [
        {
          name: 'Bakeries',
          fitSignals: [
            'Bakes on site',
            'Sells bread or pastries daily',
            'Independent, not a chain',
          ],
          exclusions: ['Chain bakeries', 'Grocery store bakeries'],
          productId: sugar,
        },
        {
          name: 'Cafés that bake',
          fitSignals: ['Bakes pastries in house', 'Has a dessert or pastry case'],
          exclusions: ['Chain coffee shops'],
          productId: sugar,
        },
        {
          name: 'Dessert shops',
          fitSignals: ['Makes desserts on site', 'Sells cakes, cookies or doughnuts'],
          exclusions: ['Frozen yogurt chains', 'Ice cream franchises'],
          productId: sugar,
        },
      ],
    },
    {
      id: demo.plans.cornerCafes,
      businessId: demo.businesses.cornerCoffee,
      name: 'Cafés near downtown Austin',
      goal: 'Cafés and brunch spots within 5 miles that could buy our espresso beans',
      area: { ...DEMO_DOWNTOWN_AUSTIN, radiusMiles: 5 },
      segments: [
        {
          name: 'Independent cafés',
          fitSignals: ['Serves espresso drinks', 'Independent, not a chain'],
          exclusions: ['Chain coffee shops'],
          productId: beans,
        },
        {
          name: 'Brunch restaurants',
          fitSignals: ['Open for breakfast or brunch', 'Serves coffee with meals'],
          exclusions: ['Fast food chains'],
          productId: beans,
        },
      ],
    },
  ];
}

/**
 * Demo data (PRD section 8a), idempotent: "Bakeries near Austin" for Sweet Supply Co (3 segments
 * pitching the cane sugar, 3 mi around 1200 E 6th St, max credits 400) and "Cafés near downtown
 * Austin" for Corner Coffee Roasters (max credits 400 against its 120 credits, for AJ-4). Plans
 * already present are left as they are.
 */
export async function seed(deps: {
  db: Database;
  clock?: Clock;
  ids?: IdGenerator;
  demo: DemoIds;
}): Promise<void> {
  const clock = deps.clock ?? new SystemClock();
  const ids = deps.ids ?? new Uuid7Generator();
  const uow = kyselyPlanningUnitOfWork(deps.db);
  const flow = LOCAL_BUYERS_FLOW_KEY;
  for (const demo of demoPlans(deps.demo)) {
    await uow.run(async ({ plans }) => {
      if (await plans.findById(demo.businessId, demo.id)) return;
      const plan = Plan.create({
        id: demo.id,
        businessId: demo.businessId,
        flowKey: flow,
        name: demo.name,
        goal: demo.goal,
        segments: demo.segments.map((s) => ({ ...s, id: ids.next() })),
        searchArea: SearchArea.of(demo.area),
        guardrails: Guardrails.of(SEEDED_PLAN_DEFAULTS, SEEDED_CEILINGS),
        productIds: new Set(demo.segments.map((s) => s.productId)),
        now: clock.now(),
      });
      await plans.save(plan);
    });
  }
}
