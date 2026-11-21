import { CodedError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import {
  addDays,
  addMonths,
  clampedDay,
  dayOfMonth,
  HISTORY_START_DAY,
  monthNumber,
  monthOf,
  roundHalfUp,
  type CalendarDay,
  type MonthKey,
} from './calendar.js';
import { COVERS_PROVIDER_CATEGORIES, type Category } from './categories.js';

export type ExpenseKind = 'recurring' | 'one_off';
export type Cadence = 'monthly' | 'yearly';
export type ExpenseStatus = 'active' | 'ending' | 'ended';

export interface PriceVersion {
  readonly id: string;
  readonly effectiveFrom: CalendarDay;
  readonly amountCents: number;
}

/** A Charge: one dated payment of a bill (derived, never stored), or a One-off. */
export interface Charge {
  readonly date: CalendarDay;
  readonly amountCents: number;
}

export interface ExpenseSnapshot {
  readonly id: string;
  readonly kind: ExpenseKind;
  readonly name: string;
  readonly vendor: string;
  readonly category: Category;
  /** null for a One-off. */
  readonly cadence: Cadence | null;
  /** The first charge date; a One-off's spent-on date. */
  readonly startsOn: CalendarDay;
  readonly endsOn: CalendarDay | null;
  /** The Tool catalog provider name this bill covers (a plan), or null. */
  readonly coversProvider: string | null;
  readonly link: string | null;
  readonly notes: string | null;
  /** Ascending by effectiveFrom; a One-off has exactly one (effectiveFrom = startsOn). */
  readonly versions: readonly PriceVersion[];
  readonly createdByMemberId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** `{ field: { from, to } }` for every field an edit changed (Audit log details). */
export type Changes = Record<string, { from: unknown; to: unknown }>;

const FAR_FUTURE: CalendarDay = '9999-12-31';
/** How far ahead a bill may start (FR-2). */
const MAX_START_AHEAD_DAYS = 366;

const beforeHistory = (field: string) =>
  new CodedError(
    'BEFORE_HISTORY_START',
    "Dates before November 2026 can't be entered",
    { field },
    422,
  );

function checkCoversCategory(category: Category, coversProvider: string | null): void {
  if (coversProvider && !COVERS_PROVIDER_CATEGORIES.includes(category)) {
    throw new CodedError(
      'COVERS_PROVIDER_CATEGORY',
      'Only AI and Data providers bills can cover a provider',
      { category },
      422,
    );
  }
}

function checkSpentOn(spentOn: CalendarDay, today: CalendarDay): void {
  if (spentOn < HISTORY_START_DAY) throw beforeHistory('spentOn');
  if (spentOn > today)
    throw new ValidationError('Invalid date', { spentOn: "Date can't be in the future" });
}

export interface NewRecurring {
  id: string;
  priceId: string;
  name: string;
  vendor: string;
  category: Category;
  amountCents: number;
  cadence: Cadence;
  startsOn: CalendarDay;
  endsOn: CalendarDay | null;
  coversProvider: string | null;
  link: string | null;
  notes: string | null;
  createdByMemberId: string;
}

export interface NewOneOff {
  id: string;
  priceId: string;
  name: string;
  vendor: string;
  category: Category;
  amountCents: number;
  spentOn: CalendarDay;
  link: string | null;
  notes: string | null;
  createdByMemberId: string;
}

export interface RecurringEdit {
  name?: string;
  vendor?: string;
  category?: Category;
  link?: string | null;
  notes?: string | null;
  /** A provider name, or null to stop covering. */
  coversProvider?: string | null;
  endsOn?: CalendarDay | null;
}

export interface OneOffEdit {
  name?: string;
  vendor?: string;
  category?: Category;
  amountCents?: number;
  spentOn?: CalendarDay;
  link?: string | null;
  notes?: string | null;
}

/** A Recurring bill or a One-off expense (FR-2, FR-3, FR-4). */
export class Expense {
  private constructor(private s: ExpenseSnapshot) {}

  static createRecurring(p: NewRecurring, now: Date, today: CalendarDay): Expense {
    if (p.startsOn < HISTORY_START_DAY) throw beforeHistory('startsOn');
    if (p.startsOn > addDays(today, MAX_START_AHEAD_DAYS)) {
      throw new ValidationError('Invalid date', {
        startsOn: "Start date can't be more than a year ahead",
      });
    }
    if (p.endsOn !== null && p.endsOn < p.startsOn) {
      throw new ValidationError('Invalid date', {
        endsOn: "End date can't be before the start date",
      });
    }
    checkCoversCategory(p.category, p.coversProvider);
    return new Expense({
      id: p.id,
      kind: 'recurring',
      name: p.name,
      vendor: p.vendor,
      category: p.category,
      cadence: p.cadence,
      startsOn: p.startsOn,
      endsOn: p.endsOn,
      coversProvider: p.coversProvider,
      link: p.link,
      notes: p.notes,
      versions: [{ id: p.priceId, effectiveFrom: p.startsOn, amountCents: p.amountCents }],
      createdByMemberId: p.createdByMemberId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  static createOneOff(p: NewOneOff, now: Date, today: CalendarDay): Expense {
    checkSpentOn(p.spentOn, today);
    return new Expense({
      id: p.id,
      kind: 'one_off',
      name: p.name,
      vendor: p.vendor,
      category: p.category,
      cadence: null,
      startsOn: p.spentOn,
      endsOn: null,
      coversProvider: null,
      link: p.link,
      notes: p.notes,
      versions: [{ id: p.priceId, effectiveFrom: p.spentOn, amountCents: p.amountCents }],
      createdByMemberId: p.createdByMemberId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  /** Rehydrate from persistence (no checks). Versions are sorted ascending. */
  static restore(s: ExpenseSnapshot): Expense {
    const versions = [...s.versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    return new Expense({ ...s, versions });
  }

  toSnapshot(): ExpenseSnapshot {
    return { ...this.s, versions: [...this.s.versions] };
  }

  get id(): string {
    return this.s.id;
  }
  get kind(): ExpenseKind {
    return this.s.kind;
  }
  get name(): string {
    return this.s.name;
  }
  get category(): Category {
    return this.s.category;
  }
  get cadence(): Cadence | null {
    return this.s.cadence;
  }
  get startsOn(): CalendarDay {
    return this.s.startsOn;
  }
  get endsOn(): CalendarDay | null {
    return this.s.endsOn;
  }
  get coversProvider(): string | null {
    return this.s.coversProvider;
  }
  get versions(): readonly PriceVersion[] {
    return this.s.versions;
  }
  get isDeleted(): boolean {
    return this.s.deletedAt !== null;
  }

  // Charges ------------------------------------------------------------------------------------

  /** The price version in effect on `day` (the first one before the bill starts). */
  priceOn(day: CalendarDay): number {
    let price = this.s.versions[0]?.amountCents ?? 0;
    for (const v of this.s.versions) if (v.effectiveFrom <= day) price = v.amountCents;
    return price;
  }

  /** The bill's charge date in `month` regardless of today: day clamped, yearly on anniversaries. */
  private chargeDateIn(month: MonthKey): CalendarDay | null {
    if (this.s.kind === 'one_off')
      return monthOf(this.s.startsOn) === month ? this.s.startsOn : null;
    if (month < monthOf(this.s.startsOn)) return null;
    if (this.s.cadence === 'yearly' && monthNumber(month) !== monthNumber(this.s.startsOn))
      return null;
    const date = clampedDay(month, dayOfMonth(this.s.startsOn));
    if (this.s.endsOn !== null && date > this.s.endsOn) return null;
    return date;
  }

  /** Charges in `month` dated today or earlier (future Charges don't count, FR-2). */
  chargesIn(month: MonthKey, today: CalendarDay): Charge[] {
    const date = this.chargeDateIn(month);
    if (date === null || date > today) return [];
    return [{ date, amountCents: this.priceOn(date) }];
  }

  /** The first charge date after today; null for a One-off or once the bill has ended. */
  nextChargeOn(today: CalendarDay): CalendarDay | null {
    if (this.s.kind === 'one_off') return null;
    const from =
      monthOf(today) > monthOf(this.s.startsOn) ? monthOf(today) : monthOf(this.s.startsOn);
    for (let i = 0; i <= 12; i += 1) {
      const date = this.chargeDateIn(addMonths(from, i));
      if (date !== null && date > today) return date;
    }
    return null;
  }

  /** A Recurring bill has charged once its first charge date (startsOn) is today or earlier. */
  hasChargedBy(today: CalendarDay): boolean {
    return this.s.kind === 'one_off' || this.s.startsOn <= today;
  }

  status(today: CalendarDay): ExpenseStatus {
    if (this.s.kind === 'one_off' || this.s.endsOn === null) return 'active';
    return this.s.endsOn < today ? 'ended' : 'ending';
  }

  /** The amount in effect today (the One-off amount; a bill's first price before it starts). */
  currentAmount(today: CalendarDay): number {
    return this.priceOn(today);
  }

  /** Yearly bills: amount / 12 rounded half up; monthly: the amount; One-off: null. */
  monthlyEquivalent(amountCents: number): number | null {
    if (this.s.kind === 'one_off') return null;
    return this.s.cadence === 'yearly' ? roundHalfUp(amountCents, 12) : amountCents;
  }

  /** A covering bill applies to a month it is active in up to `cutoff` (FR-8, the linked plan). */
  activeBetween(from: CalendarDay, to: CalendarDay): boolean {
    return this.s.startsOn <= to && (this.s.endsOn === null || this.s.endsOn >= from);
  }

  /** Coverage periods of two bills overlap (at most one bill covers a provider on any date). */
  overlaps(other: { startsOn: CalendarDay; endsOn: CalendarDay | null }): boolean {
    const end = this.s.endsOn ?? FAR_FUTURE;
    const otherEnd = other.endsOn ?? FAR_FUTURE;
    return this.s.startsOn <= otherEnd && other.startsOn <= end;
  }

  // Changes ------------------------------------------------------------------------------------

  /** FR-3: describe the bill or end it; the amount changes only through a price change. */
  editRecurring(edit: RecurringEdit, now: Date): Changes {
    this.requireKind('recurring');
    const next = { ...this.s, ...definedOnly(edit) };
    if (next.endsOn !== null && next.endsOn < next.startsOn) {
      throw new ValidationError('Invalid date', {
        endsOn: "End date can't be before the start date",
      });
    }
    checkCoversCategory(next.category, next.coversProvider);
    return this.apply(next, now);
  }

  /** FR-4: a One-off's edit may change every field, within the same date limits. */
  editOneOff(edit: OneOffEdit, now: Date, today: CalendarDay): Changes {
    this.requireKind('one_off');
    const { amountCents, spentOn, ...rest } = edit;
    const startsOn = spentOn ?? this.s.startsOn;
    if (spentOn !== undefined) checkSpentOn(spentOn, today);
    const version = this.s.versions[0];
    const versions: PriceVersion[] = version
      ? [{ ...version, effectiveFrom: startsOn, amountCents: amountCents ?? version.amountCents }]
      : [];
    const next = { ...this.s, ...definedOnly(rest), startsOn, versions };
    const changes = this.apply(next, now);
    if (amountCents !== undefined && version && amountCents !== version.amountCents) {
      changes.amountCents = { from: version.amountCents, to: amountCents };
    }
    delete changes.versions;
    if (changes.startsOn) {
      changes.spentOn = changes.startsOn;
      delete changes.startsOn;
    }
    return changes;
  }

  /**
   * FR-3: a price version from `effectiveFrom`; the same date replaces that version's amount.
   * Returns the price that was in effect on that date before.
   */
  addPrice(version: PriceVersion, now: Date): { oldCents: number } {
    if (this.s.kind !== 'recurring') {
      throw new CodedError(
        'NOT_RECURRING',
        'Only Recurring bills have price changes',
        undefined,
        409,
      );
    }
    if (version.effectiveFrom < this.s.startsOn || version.effectiveFrom < HISTORY_START_DAY) {
      throw new CodedError(
        'EFFECTIVE_BEFORE_START',
        "A price change can't start before the bill does",
        { startsOn: this.s.startsOn },
        422,
      );
    }
    const oldCents = this.priceOn(version.effectiveFrom);
    const same = this.s.versions.find((v) => v.effectiveFrom === version.effectiveFrom);
    const versions = same
      ? this.s.versions.map((v) => (v === same ? { ...v, amountCents: version.amountCents } : v))
      : [...this.s.versions, version].sort((a, b) =>
          a.effectiveFrom.localeCompare(b.effectiveFrom),
        );
    this.s = { ...this.s, versions, updatedAt: now };
    return { oldCents };
  }

  /** FR-3: removes a version other than the first. */
  removePrice(effectiveFrom: CalendarDay, now: Date): PriceVersion {
    const index = this.s.versions.findIndex((v) => v.effectiveFrom === effectiveFrom);
    const version = this.s.versions[index];
    if (!version) throw new NotFoundError('Price version not found', { effectiveFrom });
    if (index === 0) {
      throw new CodedError('FIRST_VERSION', "The first price can't be removed", undefined, 409);
    }
    this.s = { ...this.s, versions: this.s.versions.filter((v) => v !== version), updatedAt: now };
    return version;
  }

  /** FR-3: a One-off, or a Recurring bill that hasn't charged yet; otherwise end it instead. */
  markDeleted(now: Date, today: CalendarDay): void {
    if (this.s.kind === 'recurring' && this.hasChargedBy(today)) {
      throw new CodedError(
        'HAS_CHARGES',
        'This bill has charged. End the bill instead.',
        undefined,
        409,
      );
    }
    this.s = { ...this.s, deletedAt: now, updatedAt: now };
  }

  private requireKind(kind: ExpenseKind): void {
    if (this.s.kind !== kind) throw new ValidationError('Invalid change', { kind: 'Wrong kind' });
  }

  private apply(next: ExpenseSnapshot, now: Date): Changes {
    const changes: Changes = {};
    for (const key of Object.keys(next) as (keyof ExpenseSnapshot)[]) {
      const from = this.s[key];
      const to = next[key];
      if (key === 'updatedAt') continue;
      if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
    }
    if (Object.keys(changes).length > 0) this.s = { ...next, updatedAt: now };
    return changes;
  }
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
