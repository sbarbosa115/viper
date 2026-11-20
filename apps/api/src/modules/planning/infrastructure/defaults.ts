import type { RunSummary } from '@app/contracts/research';
import type { FlowDefaults, PlanActivity, RunStats } from '../application/ports.js';
import type { GuardrailCeilings, GuardrailValues } from '../domain/guardrails.js';

/** The "Local buyers" seeded plan defaults (FR-19, FR-37) and Platform ceilings (PRD section 13). */
export const SEEDED_PLAN_DEFAULTS: GuardrailValues = {
  maxCredits: 400,
  maxLeads: 100,
  minFitScore: 60,
};
export const SEEDED_CEILINGS: GuardrailCeilings = { maxCredits: 1000, maxLeads: 500 };

/** Fixed flow settings until research provides the flow's own (W3). */
export class StaticFlowDefaults implements FlowDefaults {
  constructor(
    private readonly defaults: GuardrailValues = SEEDED_PLAN_DEFAULTS,
    private readonly limits: GuardrailCeilings = SEEDED_CEILINGS,
  ) {}
  planDefaults(): Promise<GuardrailValues> {
    return Promise.resolve(this.defaults);
  }
  ceilings(): Promise<GuardrailCeilings> {
    return Promise.resolve(this.limits);
  }
}

/** No run history yet: the estimate falls back to 60% of max credits. */
export class NoRunStats implements RunStats {
  typicalCredits(): Promise<number | null> {
    return Promise.resolve(null);
  }
}

/** No runs or Leads yet: lastRun null, leadsCount 0. */
export class NoPlanActivity implements PlanActivity {
  lastRuns(): Promise<ReadonlyMap<string, RunSummary>> {
    return Promise.resolve(new Map());
  }
  leadsCounts(): Promise<ReadonlyMap<string, number>> {
    return Promise.resolve(new Map());
  }
}
