import { ValidationError } from '../../../shared/domain/errors.js';

export const MAX_SEGMENTS = 5;
export const MAX_SEGMENT_NAME = 60;
export const MAX_FIT_SIGNALS = 6;
export const MAX_EXCLUSIONS = 5;
export const MAX_CHIP = 80;

export interface TargetSegmentValues {
  readonly id: string;
  readonly name: string;
  readonly fitSignals: readonly string[];
  readonly exclusions: readonly string[];
  readonly productId: string;
}

/**
 * One kind of buyer in the Ideal Customer Profile: a name, 1–6 Fit signals, 0–5 exclusions and
 * the Product to pitch, which must be one of the Business's Products. `index` names the field in
 * errors (`segments.<index>.<field>`).
 */
export class TargetSegment implements TargetSegmentValues {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly fitSignals: readonly string[],
    readonly exclusions: readonly string[],
    readonly productId: string,
  ) {}

  static of(
    values: TargetSegmentValues,
    index: number,
    productIds: ReadonlySet<string>,
  ): TargetSegment {
    const path = (field: string) => `segments.${index}.${field}`;
    const name = values.name.trim();
    if (name.length === 0 || name.length > MAX_SEGMENT_NAME) {
      throw invalid(path('name'), `Give the segment a name of 1–${MAX_SEGMENT_NAME} characters`);
    }
    const fitSignals = chips(values.fitSignals, path('fitSignals'));
    if (fitSignals.length < 1 || fitSignals.length > MAX_FIT_SIGNALS) {
      throw invalid(path('fitSignals'), `Give 1–${MAX_FIT_SIGNALS} Fit signals`);
    }
    const exclusions = chips(values.exclusions, path('exclusions'));
    if (exclusions.length > MAX_EXCLUSIONS) {
      throw invalid(path('exclusions'), `Give at most ${MAX_EXCLUSIONS} exclusions`);
    }
    if (!productIds.has(values.productId)) {
      throw invalid(path('productId'), 'Pick one of your Products');
    }
    return new TargetSegment(values.id, name, fitSignals, exclusions, values.productId);
  }

  static restore(values: TargetSegmentValues): TargetSegment {
    return new TargetSegment(
      values.id,
      values.name,
      [...values.fitSignals],
      [...values.exclusions],
      values.productId,
    );
  }

  toSnapshot(): TargetSegmentValues {
    return {
      id: this.id,
      name: this.name,
      fitSignals: [...this.fitSignals],
      exclusions: [...this.exclusions],
      productId: this.productId,
    };
  }
}

function chips(values: readonly string[], path: string): string[] {
  const trimmed = values.map((v) => v.trim());
  if (trimmed.some((v) => v.length === 0 || v.length > MAX_CHIP)) {
    throw invalid(path, `Each item needs 1–${MAX_CHIP} characters`);
  }
  return trimmed;
}

function invalid(path: string, message: string): ValidationError {
  return new ValidationError(message, { [path]: message });
}
