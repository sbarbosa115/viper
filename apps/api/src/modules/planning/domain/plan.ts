import { ValidationError } from '../../../shared/domain/errors.js';
import { Guardrails, type GuardrailValues } from './guardrails.js';
import { SearchArea } from './search-area.js';
import { MAX_SEGMENTS, TargetSegment, type TargetSegmentValues } from './target-segment.js';

export const MAX_PLAN_NAME = 60;
export const MIN_GOAL = 5;
export const MAX_GOAL = 500;

/** Which part of the Ideal Customer Profile an edit changed (`plan_icp_edited.field`). */
export type IcpField = 'segments' | 'fit_signals' | 'exclusions' | 'product';

export interface PlanSnapshot {
  readonly id: string;
  readonly businessId: string;
  readonly flowKey: string;
  readonly name: string;
  readonly goal: string;
  readonly segments: readonly TargetSegmentValues[];
  readonly searchArea: { label: string; lat: number; lng: number; radiusMiles: number };
  readonly guardrails: GuardrailValues;
  readonly icpEditedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A segment in an edit: an existing segment's id, or none for a new one. */
export interface SegmentEdit {
  readonly id?: string | undefined;
  readonly name: string;
  readonly fitSignals: readonly string[];
  readonly exclusions: readonly string[];
  readonly productId: string;
}

/**
 * A Goal turned into a research job (FR-16, FR-17): 1–5 Target segments, a Search area and
 * Guardrails. Editable at any time (runs use a snapshot). The first change to the Ideal Customer
 * Profile (segments, Fit signals, exclusions, Product) stamps `icpEditedAt` once.
 */
export class Plan {
  private constructor(
    readonly id: string,
    readonly businessId: string,
    readonly flowKey: string,
    private _name: string,
    readonly goal: string,
    private _segments: TargetSegment[],
    private _searchArea: SearchArea,
    private _guardrails: Guardrails,
    private _icpEditedAt: Date | null,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    businessId: string;
    flowKey: string;
    name: string;
    goal: string;
    segments: readonly TargetSegmentValues[];
    searchArea: SearchArea;
    guardrails: Guardrails;
    productIds: ReadonlySet<string>;
    now: Date;
  }): Plan {
    const goal = props.goal.trim();
    if (goal.length < MIN_GOAL || goal.length > MAX_GOAL) {
      throw new ValidationError('The goal needs 5–500 characters', {
        goal: `Use ${MIN_GOAL}–${MAX_GOAL} characters`,
      });
    }
    return new Plan(
      props.id,
      props.businessId,
      props.flowKey,
      planName(props.name),
      goal,
      segmentsOf(props.segments, props.productIds),
      props.searchArea,
      props.guardrails,
      null,
      props.now,
      props.now,
    );
  }

  /** Rehydrate from persistence: no invariant re-checks. */
  static restore(s: PlanSnapshot): Plan {
    return new Plan(
      s.id,
      s.businessId,
      s.flowKey,
      s.name,
      s.goal,
      s.segments.map((seg) => TargetSegment.restore(seg)),
      SearchArea.of(s.searchArea),
      Guardrails.restore(s.guardrails),
      s.icpEditedAt,
      s.createdAt,
      s.updatedAt,
    );
  }

  get name(): string {
    return this._name;
  }
  get segments(): readonly TargetSegment[] {
    return this._segments;
  }
  get searchArea(): SearchArea {
    return this._searchArea;
  }
  get guardrails(): Guardrails {
    return this._guardrails;
  }
  get icpEditedAt(): Date | null {
    return this._icpEditedAt;
  }
  get icpEdited(): boolean {
    return this._icpEditedAt !== null;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  rename(name: string, now: Date): void {
    this._name = planName(name);
    this._updatedAt = now;
  }

  /**
   * Replaces the Target segments (add up to 5, remove while at least 1 is left, rename, chips,
   * Product). Edits name existing segments by id; new ones get `newId()`. Returns the changed ICP
   * field when this is the Plan's first ICP edit (so `plan_icp_edited` fires once), else null.
   */
  replaceSegments(
    edits: readonly SegmentEdit[],
    ctx: { productIds: ReadonlySet<string>; newId: () => string; now: Date },
  ): IcpField | null {
    const known = new Set(this._segments.map((s) => s.id));
    const seen = new Set<string>();
    const values = edits.map((edit, index): TargetSegmentValues => {
      if (edit.id !== undefined) {
        if (!known.has(edit.id) || seen.has(edit.id)) {
          throw new ValidationError('Unknown segment', {
            [`segments.${index}.id`]: 'This segment is not part of the Plan',
          });
        }
        seen.add(edit.id);
      }
      return {
        id: edit.id ?? ctx.newId(),
        name: edit.name,
        fitSignals: edit.fitSignals,
        exclusions: edit.exclusions,
        productId: edit.productId,
      };
    });
    const next = segmentsOf(values, ctx.productIds);
    const field = icpChange(this._segments, next);
    this._segments = next;
    this._updatedAt = ctx.now;
    if (field === null || this._icpEditedAt !== null) return null;
    this._icpEditedAt = ctx.now;
    return field;
  }

  changeSearchArea(area: SearchArea, now: Date): void {
    this._searchArea = area;
    this._updatedAt = now;
  }

  changeGuardrails(guardrails: Guardrails, now: Date): void {
    this._guardrails = guardrails;
    this._updatedAt = now;
  }

  usesProduct(productId: string): boolean {
    return this._segments.some((s) => s.productId === productId);
  }

  toSnapshot(): PlanSnapshot {
    return {
      id: this.id,
      businessId: this.businessId,
      flowKey: this.flowKey,
      name: this._name,
      goal: this.goal,
      segments: this._segments.map((s) => s.toSnapshot()),
      searchArea: this._searchArea.toSnapshot(),
      guardrails: this._guardrails.toSnapshot(),
      icpEditedAt: this._icpEditedAt,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    };
  }
}

function planName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_PLAN_NAME) {
    throw new ValidationError('The Plan name needs 1–60 characters', {
      name: `Use 1–${MAX_PLAN_NAME} characters`,
    });
  }
  return name;
}

function segmentsOf(
  values: readonly TargetSegmentValues[],
  productIds: ReadonlySet<string>,
): TargetSegment[] {
  if (values.length < 1 || values.length > MAX_SEGMENTS) {
    throw new ValidationError('A Plan has 1–5 Target segments', {
      segments: `Keep 1–${MAX_SEGMENTS} segments`,
    });
  }
  return values.map((v, i) => TargetSegment.of(v, i, productIds));
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** The first ICP part that differs, in the order segments, Fit signals, exclusions, Product. */
function icpChange(
  before: readonly TargetSegment[],
  after: readonly TargetSegment[],
): IcpField | null {
  const structural =
    before.length !== after.length ||
    before.some((b, i) => b.id !== after[i]?.id || b.name !== after[i]?.name);
  if (structural) return 'segments';
  const pairs = before.map((b, i) => [b, after[i]!] as const);
  if (pairs.some(([b, a]) => !sameList(b.fitSignals, a.fitSignals))) return 'fit_signals';
  if (pairs.some(([b, a]) => !sameList(b.exclusions, a.exclusions))) return 'exclusions';
  if (pairs.some(([b, a]) => b.productId !== a.productId)) return 'product';
  return null;
}
