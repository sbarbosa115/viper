import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { distanceMiles } from '../domain/normalise.js';
import {
  Prospect,
  selectForDelivery,
  type ProspectInput,
  type ProspectPatch,
  type ProspectSnapshot,
  type ProspectStage,
  type SourceRef,
} from '../domain/prospect.js';
import type { LeadsUnitOfWork, NewLead, NewSource, PlanLookup } from './ports.js';

/** A Prospect as research reads it back. */
export type ProspectView = ProspectSnapshot & { readonly stage: ProspectStage };

export interface DeliverCommand {
  readonly runId: string;
  readonly businessId: string;
  readonly planId: string;
  /** The Plan's minimum Fit score (from the run's Plan snapshot). */
  readonly minFitScore: number;
  /** The Plan's max leads (from the run's Plan snapshot). */
  readonly maxLeads: number;
}

/**
 * What research's run calls (FR-19 Steps 2–10): Prospects are written as they are found and
 * merged within the run, updated by later Steps, and delivered as Leads (FR-25).
 */
export interface ProspectStore {
  /**
   * Normalises and merges the found places with the run's Prospects (same place id, phone,
   * domain, or name within 50 m). Returns one Prospect id per input, in order; duplicates share
   * an id.
   */
  addProspects(
    runId: string,
    businessId: string,
    prospects: readonly ProspectInput[],
  ): Promise<string[]>;
  /** The run's Prospects, highest pre-score first (unscored last, then in the order found). */
  listProspects(
    runId: string,
    options?: { stage?: ProspectStage | undefined; limit?: number | undefined },
  ): Promise<ProspectView[]>;
  /** Adds website data, Contacts (with verification and Source), Evidence, scores or a Pitch. */
  updateProspect(prospectId: string, patch: ProspectPatch): Promise<ProspectView>;
  /**
   * Step 10 (FR-25), in one transaction: the run's qualified Prospects, ranked by Fit score and
   * capped at max leads, become Leads; places already delivered for the Plan never are again.
   * Idempotent: `delivered` is the run's Lead count after the call (a retry delivers nothing new).
   */
  deliver(command: DeliverCommand): Promise<{ delivered: number }>;
  /** Every place key already delivered for the Plan (FR-19 Step 3 drops these places). */
  alreadyDeliveredPlaceKeys(planId: string): Promise<ReadonlySet<string>>;
}

export interface ProspectStoreDeps {
  uow: LeadsUnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  plans: PlanLookup;
}

/** DECIMAL(6,2): distances beyond this are stored at the cap. */
const MAX_DISTANCE_MILES = 9999.99;

function view(p: Prospect): ProspectView {
  return { ...p.toSnapshot(), stage: p.stage };
}

function byPreScore(a: Prospect, b: Prospect): number {
  return (b.preScore ?? -1) - (a.preScore ?? -1);
}

function sourceKey(s: SourceRef): string {
  return JSON.stringify([s.name, s.url, s.retrievedAt]);
}

export function createProspectStoreUseCases(deps: ProspectStoreDeps): ProspectStore {
  const { uow, clock, ids, analytics, plans } = deps;

  return {
    async addProspects(runId, businessId, inputs) {
      return uow.run(async ({ prospects }) => {
        const working = await prospects.listByRun(runId);
        if (working.some((p) => p.businessId !== businessId)) {
          throw new ValidationError('The run belongs to another Business', { runId });
        }
        const changed = new Set<Prospect>();
        const result: string[] = [];
        for (const input of inputs) {
          const found = Prospect.found({
            id: ids.next(),
            runId,
            businessId,
            input,
            now: clock.now(),
          });
          const same = working.find((p) => p.isSamePlaceAs(found));
          if (same) {
            same.absorb(found);
            changed.add(same);
            result.push(same.id);
          } else {
            working.push(found);
            changed.add(found);
            result.push(found.id);
          }
        }
        for (const p of changed) await prospects.save(p);
        return result;
      });
    },

    async listProspects(runId, options = {}) {
      const all = await uow.run(({ prospects }) => prospects.listByRun(runId));
      const picked = all
        .filter((p) => !options.stage || p.stage === options.stage)
        .sort(byPreScore);
      return (options.limit === undefined ? picked : picked.slice(0, options.limit)).map(view);
    },

    async updateProspect(prospectId, patch) {
      const { prospect, checks } = await uow.run(async ({ prospects }) => {
        const p = await prospects.findById(prospectId);
        if (!p) throw new NotFoundError('Prospect not found', { prospectId });
        const results = p.apply(patch);
        await prospects.save(p);
        return { prospect: p, checks: results };
      });
      for (const check of checks) {
        await analytics.track({
          name: 'lead_contact_verified',
          properties: { run_id: prospect.runId, type: check.type, result: check.result },
        });
      }
      return view(prospect);
    },

    async deliver(command) {
      const plan = await plans.findPlan(command.businessId, command.planId);
      if (!plan) throw new NotFoundError('Plan not found', { planId: command.planId });
      return uow.run(async ({ prospects, leads }) => {
        const candidates = (await prospects.listByRun(command.runId)).filter(
          (p) => p.businessId === command.businessId,
        );
        const [deliveredKeys, already] = await Promise.all([
          leads.deliveredPlaceKeys(command.planId),
          leads.countByRun(command.runId),
        ]);
        const chosen = selectForDelivery(candidates, {
          minFitScore: command.minFitScore,
          deliveredKeys,
          capacity: Math.max(0, command.maxLeads - already),
        });
        const now = clock.now();
        const sources = new Map<string, NewSource>();
        const sourceId = (s: SourceRef): string => {
          const key = sourceKey(s);
          const known = sources.get(key);
          if (known) return known.id;
          const created = { ...s, id: ids.next() };
          sources.set(key, created);
          return created.id;
        };
        const newLeads = chosen.map((p): NewLead => {
          const s = p.toSnapshot();
          const pitch = s.pitch;
          if (!pitch || s.fitScore === null) throw new Error('Qualified Prospect without a score');
          const distance =
            s.lat !== null && s.lng !== null
              ? Math.min(MAX_DISTANCE_MILES, distanceMiles(plan.centre, { lat: s.lat, lng: s.lng }))
              : null;
          return {
            id: ids.next(),
            businessId: command.businessId,
            planId: command.planId,
            runId: command.runId,
            prospectId: s.id,
            placeKey: p.placeKey,
            name: s.name,
            category: s.category,
            address: s.address,
            distanceMiles: distance,
            fitScore: s.fitScore,
            pitch,
            deliveredAt: now,
            contacts: p.deliverableContacts().map((c) => ({
              id: ids.next(),
              type: c.type,
              value: c.value,
              label: c.label,
              verification: c.verification === 'verified' ? 'verified' : 'unverified',
              sourceId: sourceId(c.source),
            })),
            evidence: s.evidence.map((e) => ({
              id: ids.next(),
              fact: e.fact,
              points: e.points,
              sourceId: sourceId(e.source),
            })),
          };
        });
        if (newLeads.length > 0) await leads.insert([...sources.values()], newLeads);
        return { delivered: already + newLeads.length };
      });
    },

    alreadyDeliveredPlaceKeys(planId) {
      return uow.run(({ leads }) => leads.deliveredPlaceKeys(planId));
    },
  };
}
