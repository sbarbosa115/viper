import type { Dashboard, Metric } from '@app/contracts/reporting';
import { runFailureCode } from '@app/contracts/errors';
import type { Actor } from '../../../shared/domain/actor.js';
import {
  customerCounts,
  isCustomer,
  latestSignups,
  signupsByDay,
  type BusinessFact,
} from '../domain/customers.js';
import {
  activeBusinessIds,
  failedRuns,
  goodLeadsPerActiveBusinessPerWeek,
  providerRows,
  runMetrics,
  topBusinessesByCredits,
  type RunFact,
} from '../domain/metrics.js';
import { periodWindows, type DashboardPeriod, type TimeWindow } from '../domain/period.js';
import type { CreditsSummary, LeadQualityFacts, ReportingDeps } from './ports.js';
import { requireStaff } from './staff-policy.js';

export const FAILED_RUNS_LIMIT = 20;
export const TABLE_LIMIT = 10;

const metric = (value: number | null, previous: number | null): Metric => ({ value, previous });

/** Everything one period needs from the other contexts. */
interface PeriodFacts {
  window: TimeWindow;
  runs: RunFact[];
  quality: LeadQualityFacts;
  credits: CreditsSummary;
  payingIds: ReadonlySet<string>;
}

/**
 * FR-30: the Staff dashboard for a period, compared with the previous period. Customer and
 * revenue tiles (and the tables) leave out Staff's own and internal Businesses; run and Lead
 * quality tiles count every Business.
 */
export class GetDashboard {
  constructor(private readonly deps: ReportingDeps) {}

  async execute(query: { actor: Actor | null; period: DashboardPeriod }): Promise<Dashboard> {
    requireStaff(query.actor);
    const windows = periodWindows(query.period, this.deps.clock.now());
    const businesses = await this.deps.identity.allBusinesses();
    const customers = businesses.filter(isCustomer);
    const customerIds = new Set(customers.map((c) => c.id));
    const excluded = businesses.filter((b) => !customerIds.has(b.id)).map((b) => b.id);
    const [current, previous, spend] = await Promise.all([
      this.periodFacts(windows.current, customers, excluded),
      this.periodFacts(windows.previous, customers, excluded),
      this.deps.tools.spendByTool(windows.current),
    ]);

    const names = new Map(businesses.map((b) => [b.id, b.name]));
    const counts = (p: PeriodFacts) =>
      customerCounts(customers, p.window, {
        activeIds: activeBusinessIds(p.runs),
        payingIds: p.payingIds,
      });
    const c = counts(current);
    const pc = counts(previous);
    const r = runMetrics(current.runs);
    const pr = runMetrics(previous.runs);
    const northStar = (p: PeriodFacts) =>
      goodLeadsPerActiveBusinessPerWeek(
        p.quality.good,
        activeBusinessIds(p.runs).size,
        windows.days,
      );

    return {
      period: query.period,
      customers: {
        total: metric(c.total, pc.total),
        newSignups: {
          ...metric(c.newSignups, pc.newSignups),
          byDay: signupsByDay(customers, current.window),
        },
        verified: metric(c.verified, pc.verified),
        active: metric(c.active, pc.active),
        paying: metric(c.paying, pc.paying),
        trialToPaidPct: metric(c.trialToPaidPct, pc.trialToPaidPct),
      },
      revenue: {
        packRevenue: {
          value: { cents: current.credits.packRevenueCents, currency: 'usd' },
          previous: { cents: previous.credits.packRevenueCents, currency: 'usd' },
        },
        creditsGranted: metric(current.credits.creditsGranted, previous.credits.creditsGranted),
        creditsPurchased: metric(
          current.credits.creditsPurchased,
          previous.credits.creditsPurchased,
        ),
        creditsSpent: metric(current.credits.creditsSpent, previous.credits.creditsSpent),
        // A balance right now: there is no history to compare with.
        unspentCredits: metric(current.credits.unspentCredits, null),
      },
      runs: {
        started: metric(r.started, pr.started),
        completedPct: metric(r.completedPct, pr.completedPct),
        withinLimitsPct: metric(r.withinLimitsPct, pr.withinLimitsPct),
        medianDurationS: metric(r.medianDurationS, pr.medianDurationS),
        avgCredits: metric(r.avgCredits, pr.avgCredits),
        failed: failedRuns(current.runs, FAILED_RUNS_LIMIT).map((run) => ({
          runId: run.runId,
          businessName: names.get(run.businessId) ?? 'Unknown business',
          failureReason: runFailureCode.safeParse(run.failureCode).data ?? null,
          at: (run.finishedAt ?? run.queuedAt).toISOString(),
        })),
      },
      leads: {
        delivered: metric(current.quality.delivered, previous.quality.delivered),
        goodPct: metric(current.quality.goodPct, previous.quality.goodPct),
        verifiedPct: metric(current.quality.verifiedPct, previous.quality.verifiedPct),
        providerCostPerLeadCents: metric(r.providerCostPerLeadCents, pr.providerCostPerLeadCents),
        creditsPerLead: metric(r.creditsPerLead, pr.creditsPerLead),
        grossMarginPct: metric(r.grossMarginPct, pr.grossMarginPct),
      },
      plans: { noIcpEditPct: metric(r.noIcpEditPct, pr.noIcpEditPct) },
      northStar: {
        goodLeadsPerActiveBusinessPerWeek: metric(northStar(current), northStar(previous)),
      },
      providers: providerRows(spend),
      topBusinesses: topBusinessesByCredits(
        current.runs,
        (id) => customerIds.has(id),
        TABLE_LIMIT,
      ).map((t) => ({
        id: t.businessId,
        name: names.get(t.businessId) ?? '',
        creditsSpent: t.creditsSpent,
      })),
      latestSignups: latestSignups(customers, TABLE_LIMIT).map((b: BusinessFact) => ({
        id: b.id,
        name: b.name,
        ownerEmail: b.ownerEmail,
        createdAt: b.signedUpAt.toISOString(),
      })),
    };
  }

  private async periodFacts(
    window: TimeWindow,
    customers: readonly BusinessFact[],
    excludeBusinessIds: readonly string[],
  ): Promise<PeriodFacts> {
    const { research, leads, billing } = this.deps;
    const [runs, quality, credits, payingIds] = await Promise.all([
      research.runFacts(window),
      leads.leadQuality(window),
      billing.creditsSummary({ from: window.from, to: window.to, excludeBusinessIds }),
      billing.payingBusinessIds(
        customers.map((c) => c.id),
        { paidBefore: window.to },
      ),
    ]);
    return { window, runs, quality, credits, payingIds };
  }
}
