import { ValidationError } from '../../../shared/domain/errors.js';
import { RateCard } from './rate-card.js';

export interface ToolSnapshot {
  readonly key: string;
  readonly name: string;
  readonly provider: string;
  /** e.g. "request", "result", "page", "email", "lookup", "1k tokens in". */
  readonly unit: string;
  readonly creditsPerUnit: number;
  readonly providerCostMicrosPerUnit: number;
  readonly enabled: boolean;
  /** The most units one call may use: the budget check charges this up front (FR-20). */
  readonly maxUnitsPerCall: number;
  readonly updatedAt: Date;
}

export interface ToolChanges {
  readonly enabled?: boolean | undefined;
  readonly creditsPerUnit?: number | undefined;
  readonly providerCostMicrosPerUnit?: number | undefined;
}

/** A Tool in the catalog with its Rate card (FR-23). Staff enable, disable and reprice it. */
export class Tool {
  private constructor(
    readonly key: string,
    readonly name: string,
    readonly provider: string,
    readonly unit: string,
    private _rateCard: RateCard,
    private _enabled: boolean,
    readonly maxUnitsPerCall: number,
    private _updatedAt: Date,
  ) {}

  static restore(s: ToolSnapshot): Tool {
    return new Tool(
      s.key,
      s.name,
      s.provider,
      s.unit,
      RateCard.of(s),
      s.enabled,
      s.maxUnitsPerCall,
      s.updatedAt,
    );
  }

  static define(s: ToolSnapshot): Tool {
    if (!Number.isInteger(s.maxUnitsPerCall) || s.maxUnitsPerCall < 1) {
      throw new ValidationError('Max units per call must be a positive whole number', {
        maxUnitsPerCall: 'Must be at least 1',
      });
    }
    return Tool.restore(s);
  }

  get enabled(): boolean {
    return this._enabled;
  }
  get rateCard(): RateCard {
    return this._rateCard;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  /** Applies a Staff change; returns the names of the fields that actually changed. */
  change(changes: ToolChanges, now: Date): string[] {
    const changed: string[] = [];
    if (changes.enabled !== undefined && changes.enabled !== this._enabled) {
      this._enabled = changes.enabled;
      changed.push('enabled');
    }
    const credits = changes.creditsPerUnit ?? this._rateCard.creditsPerUnit;
    const cost = changes.providerCostMicrosPerUnit ?? this._rateCard.providerCostMicrosPerUnit;
    const next = RateCard.of({ creditsPerUnit: credits, providerCostMicrosPerUnit: cost });
    if (next.millicreditsPerUnit !== this._rateCard.millicreditsPerUnit) {
      changed.push('creditsPerUnit');
    }
    if (next.providerCostMicrosPerUnit !== this._rateCard.providerCostMicrosPerUnit) {
      changed.push('providerCostMicrosPerUnit');
    }
    this._rateCard = next;
    if (changed.length > 0) this._updatedAt = now;
    return changed;
  }

  /** The most a call of `units` (capped at max units per call) can cost, in millicredits. */
  maxCostMillicredits(units: number): number {
    return this._rateCard.millicreditsFor(Math.min(units, this.maxUnitsPerCall));
  }

  toSnapshot(): ToolSnapshot {
    return {
      key: this.key,
      name: this.name,
      provider: this.provider,
      unit: this.unit,
      creditsPerUnit: this._rateCard.creditsPerUnit,
      providerCostMicrosPerUnit: this._rateCard.providerCostMicrosPerUnit,
      enabled: this._enabled,
      maxUnitsPerCall: this.maxUnitsPerCall,
      updatedAt: this._updatedAt,
    };
  }
}
