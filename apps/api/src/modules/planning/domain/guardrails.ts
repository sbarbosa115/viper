import { ValidationError } from '../../../shared/domain/errors.js';

export const MIN_MAX_CREDITS = 10;
export const MIN_MAX_LEADS = 10;
export const MIN_FIT_SCORE = 40;
export const MAX_FIT_SCORE = 90;

/** The highest max credits and max leads a Plan may use (the flow's run limits within ceilings). */
export interface GuardrailCeilings {
  readonly maxCredits: number;
  readonly maxLeads: number;
}

export interface GuardrailValues {
  readonly maxCredits: number;
  readonly maxLeads: number;
  readonly minFitScore: number;
}

/**
 * A Plan's limits on its runs (FR-17): max credits 10..ceiling, max leads 10..ceiling, min Fit
 * score 40–90, all whole numbers. Errors name `guardrails.<field>`.
 */
export class Guardrails implements GuardrailValues {
  private constructor(
    readonly maxCredits: number,
    readonly maxLeads: number,
    readonly minFitScore: number,
  ) {}

  static of(values: GuardrailValues, ceilings: GuardrailCeilings): Guardrails {
    checkRange('maxCredits', values.maxCredits, MIN_MAX_CREDITS, ceilings.maxCredits);
    checkRange('maxLeads', values.maxLeads, MIN_MAX_LEADS, ceilings.maxLeads);
    checkRange('minFitScore', values.minFitScore, MIN_FIT_SCORE, MAX_FIT_SCORE);
    return new Guardrails(values.maxCredits, values.maxLeads, values.minFitScore);
  }

  /** Rehydrate stored values without re-checking (ceilings may have changed since). */
  static restore(values: GuardrailValues): Guardrails {
    return new Guardrails(values.maxCredits, values.maxLeads, values.minFitScore);
  }

  /**
   * FR-16: the flow's plan defaults, kept within the ceilings; when the Business's available
   * credits are below the default max credits, max credits is the available balance (at least 10)
   * so a trial Business can run on its 50 free credits.
   */
  static defaults(
    defaults: GuardrailValues,
    ceilings: GuardrailCeilings,
    availableCredits: number,
  ): Guardrails {
    const flowMax = Math.min(defaults.maxCredits, ceilings.maxCredits);
    const maxCredits = Math.max(MIN_MAX_CREDITS, Math.min(flowMax, Math.floor(availableCredits)));
    const maxLeads = Math.max(MIN_MAX_LEADS, Math.min(defaults.maxLeads, ceilings.maxLeads));
    const minFitScore = Math.min(MAX_FIT_SCORE, Math.max(MIN_FIT_SCORE, defaults.minFitScore));
    return new Guardrails(maxCredits, maxLeads, minFitScore);
  }

  toSnapshot(): GuardrailValues {
    return { maxCredits: this.maxCredits, maxLeads: this.maxLeads, minFitScore: this.minFitScore };
  }
}

function checkRange(field: keyof GuardrailValues, value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    const message = `Must be a whole number from ${min} to ${max}`;
    throw new ValidationError(message, { [`guardrails.${field}`]: message });
  }
}
