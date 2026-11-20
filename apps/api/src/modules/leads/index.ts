import type { FastifyInstance } from 'fastify';
import type { AnalyticsTracker } from '../../shared/application/analytics-tracker.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import { SystemClock } from '../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../shared/infrastructure/time/uuid7.js';
import { DEMO_SWEET_SUPPLY_LOCATION } from '../planning/index.js';
import { createLeadsApplication, type LeadsApplication } from './application/leads.js';
import type { LeadQueries } from './application/lead-queries.js';
import type { LeadsUnitOfWork, PlanLookup, RunCosts } from './application/ports.js';
import type { ProspectStore } from './application/prospect-store.js';
import { leadsRoutes } from './http/leads.routes.js';
import {
  DEMO_FEEDBACK,
  DEMO_PLACES,
  demoEnrichment,
  demoProspectInput,
} from './infrastructure/demo-leads.js';
import { InMemoryLeads } from './infrastructure/in-memory-leads.js';
import { kyselyLeadsUnitOfWork } from './infrastructure/kysely-leads.js';

export type { DeliverCommand, ProspectStore, ProspectView } from './application/prospect-store.js';
export type { LeadQuality, PlanLookup, RunCosts } from './application/ports.js';
export type {
  ContactInput,
  ContactType,
  EvidenceItem,
  Listing,
  Pitch,
  ProspectInput,
  ProspectPatch,
  ProspectStage,
  SourceRef,
  Verification,
  WebsiteData,
} from './domain/prospect.js';

/** What leads needs from the composition root. */
export interface LeadsDeps {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  /** planning: `getPlanSnapshot(businessId, planId)` → `{ id, name, centre: searchArea lat/lng }`. */
  plans: PlanLookup;
  /** research: credits spent by a Plan's runs; 0 when absent (until research lands). */
  runCosts?: RunCosts;
}

/** Reads other modules use (planning's PlanActivity.leadsCounts, reporting). */
export interface LeadsQueries {
  /** Lead count per Plan of the Business (Plans without Leads are left out). */
  leadsCounts(businessId: string, planIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /** Leads delivered per Business (customer list, FR-31). */
  deliveredCounts(businessIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /** Delivered, Good lead % and verified-contact % for Leads delivered in [from, to) (FR-30). */
  leadQuality: LeadQueries['leadQuality'];
}

/** The HTTP module's shape (matches app.ts AppModule). */
export interface LeadsHttpModule {
  readonly name: 'leads';
  register(app: FastifyInstance): void;
}

export interface Leads {
  module: LeadsHttpModule;
  /** research's run (FR-19 Steps 2–10). */
  prospectStore: ProspectStore;
  leadsQueries: LeadsQueries;
  /** Every use case (seed, tests). */
  application: LeadsApplication;
}

/** No research yet: no credits spent. */
const NO_RUN_COSTS: RunCosts = { creditsSpentForPlan: () => Promise.resolve(0) };

function assemble(uow: LeadsUnitOfWork, deps: Omit<LeadsDeps, 'db'>): Leads {
  const application = createLeadsApplication({
    uow,
    clock: deps.clock,
    ids: deps.ids,
    analytics: deps.analytics,
    plans: deps.plans,
    runCosts: deps.runCosts ?? NO_RUN_COSTS,
  });
  const { queries } = application;
  return {
    application,
    prospectStore: application.prospects,
    leadsQueries: {
      leadsCounts: queries.leadsCounts.bind(queries),
      deliveredCounts: queries.deliveredCounts.bind(queries),
      leadQuality: queries.leadQuality.bind(queries),
    },
    module: { name: 'leads', register: (app) => leadsRoutes(app, application) },
  };
}

/** leads: Prospects, Leads, Contacts, Sources, Evidence, Feedback and CSV export (FR-25 to FR-28). */
export function createLeads(deps: LeadsDeps): Leads {
  const { db, ...rest } = deps;
  return assemble(kyselyLeadsUnitOfWork(db), rest);
}

/** research's port to Prospects and delivery. */
export function createProspectStore(deps: LeadsDeps): ProspectStore {
  return createLeads(deps).prospectStore;
}

export function createLeadsQueries(deps: LeadsDeps): LeadsQueries {
  return createLeads(deps).leadsQueries;
}

export function createLeadsModule(deps: LeadsDeps): LeadsHttpModule {
  return createLeads(deps).module;
}

/** The same module on in-memory storage, for other modules' tests (research, reporting). */
export function createInMemoryLeads(deps: Omit<LeadsDeps, 'db'>): Leads & { store: InMemoryLeads } {
  const store = new InMemoryLeads();
  return { ...assemble(store, deps), store };
}

/**
 * Placeholder kept so composition.ts compiles until it registers `createLeads(...).module`
 * instead (it has no routes).
 */
export const leadsModule = {
  name: 'leads',
  register(_app: FastifyInstance): void {
    // Replaced by createLeads(...).module in the composition root.
  },
};

// Demo data -------------------------------------------------------------------------------------

/** Fixed ids the seed shares across modules (scripts/seed.ts `demo`). */
interface DemoIds {
  businesses: { sweetSupply: string };
  members: { owner: string };
  products: { caneSugar: string };
  plans: { bakeriesNearAustin: string };
  runs: { bakeriesNearAustin: string };
}

const DEMO_PLAN = { name: 'Bakeries near Austin', minFitScore: 60, maxLeads: 100 };
const DEMO_PRODUCT_NAME = 'Cane sugar, 50 lb bag';

const silent: AnalyticsTracker = { track: () => Promise.resolve() };

/**
 * Demo data (PRD section 8a), idempotent: the demo run of "Bakeries near Austin" (Sweet Supply
 * Co) found 30 places; 25 become Leads with mixed Fit scores, every Contact and Evidence item with
 * a Source; Feedback on 5. Skipped when the run already has Leads. Writes no analytics events.
 */
export async function seed(deps: {
  db: Database;
  clock?: Clock;
  ids?: IdGenerator;
  demo: DemoIds;
}): Promise<void> {
  const { demo } = deps;
  const businessId = demo.businesses.sweetSupply;
  const planId = demo.plans.bakeriesNearAustin;
  const runId = demo.runs.bakeriesNearAustin;
  const leads = createLeads({
    db: deps.db,
    clock: deps.clock ?? new SystemClock(),
    ids: deps.ids ?? new Uuid7Generator(),
    analytics: silent,
    plans: {
      findPlan: (b, p) =>
        Promise.resolve(
          b === businessId && p === planId
            ? { id: planId, name: DEMO_PLAN.name, centre: DEMO_SWEET_SUPPLY_LOCATION }
            : null,
        ),
    },
  });
  const uow = kyselyLeadsUnitOfWork(deps.db);
  if ((await uow.run(({ leads: repo }) => repo.countByRun(runId))) > 0) return;

  const store = leads.prospectStore;
  const retrievedAt = (deps.clock ?? new SystemClock()).now().toISOString();
  const product = { id: demo.products.caneSugar, name: DEMO_PRODUCT_NAME };
  const ids = await store.addProspects(
    runId,
    businessId,
    DEMO_PLACES.map((place, i) =>
      demoProspectInput(place, i, DEMO_SWEET_SUPPLY_LOCATION, retrievedAt),
    ),
  );
  for (const [i, place] of DEMO_PLACES.entries()) {
    const id = ids[i];
    if (!id) continue;
    const found = demoEnrichment(place, i, retrievedAt, product);
    await store.updateProspect(id, {
      preScore: Math.min(100, (place.fitScore ?? 50) + 3),
      contacts: found.contacts,
      ...(place.fitScore === null
        ? {}
        : { fitScore: place.fitScore, evidence: found.evidence, pitch: found.pitch }),
    });
  }
  await store.deliver({ runId, businessId, planId, ...DEMO_PLAN });

  const owner = {
    memberId: demo.members.owner,
    businessId,
    roles: ['owner'] as const,
    emailVerified: true,
  };
  const delivered = await leads.application.queries.listLeads(owner, planId, {
    sort: 'score',
    limit: 100,
  });
  for (const fb of DEMO_FEEDBACK) {
    const lead = delivered.items.find((l) => l.name === fb.name);
    if (lead) {
      await leads.application.setFeedback.execute(owner, lead.id, {
        value: fb.value,
        reason: fb.reason,
      });
    }
  }
}
