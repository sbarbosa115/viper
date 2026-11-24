import type {
  AddPriceBody,
  Category as CategoryDto,
  CreateExpenseBody,
  Expense as ExpenseDto,
  ExpenseKind,
  OneOffExpensePatch,
  RecurringExpensePatch,
} from '@app/contracts/finance';
import type { Actor } from '../../../shared/domain/actor.js';
import { CodedError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { sum, type CalendarDay, type MonthKey } from '../domain/calendar.js';
import { Expense, type Changes, type RecurringEdit } from '../domain/expense.js';
import { fixedRunRateCents } from '../domain/pnl.js';
import type { FinanceContext, FinanceRepos } from './ports.js';
import {
  providerByKey,
  requireStaff,
  resolveMonth,
  staffAnalyticsActor,
  todayOf,
} from './rules.js';
import { expenseView, money } from './views.js';

type Ctx = Pick<FinanceContext, 'store' | 'tools' | 'analytics' | 'clock' | 'ids'>;

const audit = (
  repos: FinanceRepos,
  actor: Actor,
  action: string,
  expenseId: string,
  details: Record<string, unknown>,
) =>
  repos.audit.record({
    staffMemberId: actor.memberId,
    businessId: null,
    action,
    targetType: 'expense',
    targetId: expenseId,
    details,
  });

async function findOr404(repos: Pick<FinanceRepos, 'expenses'>, id: string): Promise<Expense> {
  const expense = await repos.expenses.findById(id);
  if (!expense) throw new NotFoundError('Expense not found', { id });
  return expense;
}

/**
 * FR-2: at most one bill covers a provider on any date (409 PROVIDER_ALREADY_COVERED). The caller
 * holds `lockCoverage` from the start of its transaction, so two writes can't both pass the check.
 */
async function checkCoverage(repos: FinanceRepos, expense: Expense): Promise<void> {
  if (!expense.coversProvider) return;
  const others = await repos.expenses.listAll();
  const clash = others.find(
    (o) =>
      o.id !== expense.id &&
      o.kind === 'recurring' &&
      o.coversProvider === expense.coversProvider &&
      o.overlaps(expense),
  );
  if (clash) {
    throw new CodedError(
      'PROVIDER_ALREADY_COVERED',
      `${clash.name} already covers ${expense.coversProvider}`,
      { expenseId: clash.id, name: clash.name },
      409,
    );
  }
}

async function providerName(
  ctx: Ctx,
  key: string | null | undefined,
): Promise<string | null | undefined> {
  if (key === undefined || key === null) return key;
  return (await providerByKey(ctx.tools, key)).name;
}

const current = (ctx: Ctx, expense: Expense) => {
  const today = todayOf(ctx.clock);
  return expenseView(expense, today.slice(0, 7), today);
};

// FR-1 ---------------------------------------------------------------------------------------------

export interface ListExpensesQuery {
  month?: MonthKey;
  category?: CategoryDto;
  kind?: ExpenseKind;
  includeEnded: boolean;
}

/**
 * FR-1: Recurring bills that are not ended (or, with `includeEnded`, every one), plus any bill that
 * charged in the month, and the month's One-offs. Recurring first, then by name.
 */
export class ListExpenses {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null, query: ListExpensesQuery) {
    requireStaff(caller);
    const month = resolveMonth(query.month, this.ctx.clock);
    const today = todayOf(this.ctx.clock);
    const all = await this.ctx.store.read.expenses.listAll();
    const inMonth = (e: Expense) => e.chargesIn(month, today).length > 0;
    const listed = all
      .filter((e) =>
        e.kind === 'one_off'
          ? e.startsOn.slice(0, 7) === month
          : query.includeEnded || e.status(today) !== 'ended' || inMonth(e),
      )
      .filter((e) => !query.category || e.category === query.category)
      .filter((e) => !query.kind || e.kind === query.kind)
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'recurring' ? -1 : 1,
      );
    const items = listed.map((e) => expenseView(e, month, today));
    return {
      month,
      items,
      totals: {
        fixedRunRate: money(fixedRunRateCents(all, today)),
        chargesInMonth: money(
          sum(items.flatMap((i) => i.chargesInMonth.map((c) => c.amount.cents))),
        ),
      },
    };
  }
}

// FR-2, FR-4 ---------------------------------------------------------------------------------------

export class CreateExpense {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null, body: CreateExpenseBody): Promise<ExpenseDto> {
    const actor = requireStaff(caller);
    const { clock, ids } = this.ctx;
    const now = clock.now();
    const today = todayOf(clock);
    const common = {
      id: ids.next(),
      priceId: ids.next(),
      name: body.name,
      vendor: body.vendor,
      category: body.category,
      amountCents: body.amountCents,
      link: body.link ?? null,
      notes: body.notes ?? null,
      createdByMemberId: actor.memberId,
    };
    const expense =
      body.kind === 'recurring'
        ? Expense.createRecurring(
            {
              ...common,
              cadence: body.cadence,
              startsOn: body.startsOn,
              endsOn: body.endsOn ?? null,
              coversProvider: (await providerName(this.ctx, body.coversProvider)) ?? null,
            },
            now,
            today,
          )
        : Expense.createOneOff({ ...common, spentOn: body.spentOn }, now, today);

    await this.ctx.store.run(async (repos) => {
      if (expense.coversProvider) await repos.expenses.lockCoverage();
      await checkCoverage(repos, expense);
      await repos.expenses.save(expense);
      const s = expense.toSnapshot();
      await audit(repos, actor, 'expense.created', expense.id, {
        kind: s.kind,
        name: s.name,
        vendor: s.vendor,
        category: s.category,
        amountCents: body.amountCents,
        cadence: s.cadence,
        startsOn: s.startsOn,
        endsOn: s.endsOn,
        coversProvider: s.coversProvider,
      });
    });
    await this.ctx.analytics.track({
      name: 'expense_created',
      actor: staffAnalyticsActor(actor),
      properties: {
        expense_id: expense.id,
        kind: expense.kind,
        category: expense.category,
        cadence: expense.cadence,
        covers_provider: expense.coversProvider !== null,
      },
    });
    return current(this.ctx, expense);
  }
}

// FR-3, FR-4 ---------------------------------------------------------------------------------------

/** A PATCH body as one kind's edit, or that kind's field errors (a field of the other kind). */
export type KindPatch<T> =
  | { readonly ok: true; readonly patch: T }
  | { readonly ok: false; readonly fields: Record<string, string> };

/** The PATCH body parsed by the route for both kinds; the use case picks the Expense's kind. */
export interface ExpensePatch {
  readonly recurring: KindPatch<RecurringExpensePatch>;
  readonly oneOff: KindPatch<OneOffExpensePatch>;
}

function patchFor<T>(parsed: KindPatch<T>): T {
  if (!parsed.ok) throw new ValidationError('The request is not valid', parsed.fields);
  return parsed.patch;
}

/** The edit can change which provider the bill covers, or when it does (FR-2 coverage rule). */
const touchesCoverage = (p: ExpensePatch) =>
  p.recurring.ok &&
  (p.recurring.patch.coversProvider !== undefined || p.recurring.patch.endsOn !== undefined);

export class UpdateExpense {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null, id: string, body: ExpensePatch): Promise<ExpenseDto> {
    const actor = requireStaff(caller);
    const now = this.ctx.clock.now();
    const today = todayOf(this.ctx.clock);
    const expense = await this.ctx.store.run(async (repos) => {
      // Lock before the first read, so the coverage check reads what committed before the lock.
      if (touchesCoverage(body)) await repos.expenses.lockCoverage();
      const expense = await findOr404(repos, id);
      let changes: Changes;
      if (expense.kind === 'recurring') {
        const { coversProvider, ...rest } = patchFor(body.recurring);
        const edit: RecurringEdit = { ...rest };
        const name = await providerName(this.ctx, coversProvider);
        if (name !== undefined) edit.coversProvider = name;
        changes = expense.editRecurring(edit, now);
        if (changes.coversProvider || changes.endsOn) await checkCoverage(repos, expense);
      } else {
        changes = expense.editOneOff(patchFor(body.oneOff), now, today);
      }
      if (Object.keys(changes).length > 0) {
        await repos.expenses.save(expense);
        const keys = Object.keys(changes);
        const ended = keys.length === 1 && keys[0] === 'endsOn' && changes.endsOn?.to !== null;
        await audit(repos, actor, ended ? 'expense.ended' : 'expense.updated', expense.id, changes);
      }
      return expense;
    });
    return current(this.ctx, expense);
  }
}

export class AddExpensePrice {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null, id: string, body: AddPriceBody): Promise<ExpenseDto> {
    const actor = requireStaff(caller);
    const now = this.ctx.clock.now();
    const { expense, oldCents } = await this.ctx.store.run(async (repos) => {
      const expense = await findOr404(repos, id);
      const { oldCents } = expense.addPrice(
        {
          id: this.ctx.ids.next(),
          effectiveFrom: body.effectiveFrom,
          amountCents: body.amountCents,
        },
        now,
      );
      await repos.expenses.save(expense);
      await audit(repos, actor, 'expense.price_changed', expense.id, {
        effectiveFrom: body.effectiveFrom,
        amountCents: { from: oldCents, to: body.amountCents },
      });
      return { expense, oldCents };
    });
    await this.ctx.analytics.track({
      name: 'expense_price_changed',
      actor: staffAnalyticsActor(actor),
      properties: {
        expense_id: expense.id,
        effective_from: body.effectiveFrom,
        old_cents: oldCents,
        new_cents: body.amountCents,
      },
    });
    return current(this.ctx, expense);
  }
}

export class DeleteExpensePrice {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null, id: string, effectiveFrom: CalendarDay): Promise<ExpenseDto> {
    const actor = requireStaff(caller);
    const now = this.ctx.clock.now();
    const expense = await this.ctx.store.run(async (repos) => {
      const expense = await findOr404(repos, id);
      const removed = expense.removePrice(effectiveFrom, now);
      await repos.expenses.save(expense);
      await audit(repos, actor, 'expense.price_changed', expense.id, {
        effectiveFrom,
        amountCents: { from: removed.amountCents, to: null },
      });
      return expense;
    });
    return current(this.ctx, expense);
  }
}

export class DeleteExpense {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null, id: string): Promise<void> {
    const actor = requireStaff(caller);
    const now = this.ctx.clock.now();
    const today = todayOf(this.ctx.clock);
    await this.ctx.store.run(async (repos) => {
      const expense = await findOr404(repos, id);
      const before = expense.toSnapshot();
      expense.markDeleted(now, today);
      await repos.expenses.save(expense);
      await audit(repos, actor, 'expense.deleted', expense.id, {
        before: {
          kind: before.kind,
          name: before.name,
          category: before.category,
          amountCents: expense.currentAmount(today),
          startsOn: before.startsOn,
        },
        after: { deletedAt: now.toISOString() },
      });
    });
  }
}
