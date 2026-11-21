import {
  oneOffExpensePatch,
  recurringExpensePatch,
  type AddPriceBody,
  type Category as CategoryDto,
  type CreateExpenseBody,
  type Expense as ExpenseDto,
  type ExpenseKind,
  type UpdateExpenseBody,
} from '@app/contracts/finance';
import type { Actor } from '../../../shared/domain/actor.js';
import { CodedError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { sum, type CalendarDay, type MonthKey } from '../domain/calendar.js';
import { Expense, type Changes, type RecurringEdit } from '../domain/expense.js';
import { fixedRunRateCents } from '../domain/pnl.js';
import type { FinanceContext, FinanceRepos } from './ports.js';
import { providerByKey, requireStaff, resolveMonth, todayOf } from './rules.js';
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

const analyticsActor = (actor: Actor) => ({
  memberId: actor.memberId,
  businessId: actor.businessId,
});

async function findOr404(repos: Pick<FinanceRepos, 'expenses'>, id: string): Promise<Expense> {
  const expense = await repos.expenses.findById(id);
  if (!expense) throw new NotFoundError('Expense not found', { id });
  return expense;
}

/** FR-2: at most one bill covers a provider on any date (409 PROVIDER_ALREADY_COVERED). */
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
      actor: analyticsActor(actor),
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

/** Parses the PATCH body again for the Expense's kind: a field of the other kind is a 400. */
interface PatchIssue {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly keys?: readonly string[];
}

/** The part of a contract schema the use case needs (keeps zod out of the application layer). */
interface PatchSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: readonly PatchIssue[] } };
}

function parsePatch<T>(schema: PatchSchema<T>, body: UpdateExpenseBody, kindLabel: string): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys ?? []) fields[key] = `Can't be changed on a ${kindLabel}`;
    } else {
      fields[issue.path.map(String).join('.') || '_'] = issue.message;
    }
  }
  throw new ValidationError('The request is not valid', fields);
}

export class UpdateExpense {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null, id: string, body: UpdateExpenseBody): Promise<ExpenseDto> {
    const actor = requireStaff(caller);
    const now = this.ctx.clock.now();
    const today = todayOf(this.ctx.clock);
    const expense = await this.ctx.store.run(async (repos) => {
      const expense = await findOr404(repos, id);
      let changes: Changes;
      if (expense.kind === 'recurring') {
        const patch = parsePatch(recurringExpensePatch, body, 'Recurring bill');
        const { coversProvider, ...rest } = patch;
        const edit: RecurringEdit = { ...rest };
        const name = await providerName(this.ctx, coversProvider);
        if (name !== undefined) edit.coversProvider = name;
        changes = expense.editRecurring(edit, now);
        if (changes.coversProvider || changes.endsOn) await checkCoverage(repos, expense);
      } else {
        changes = expense.editOneOff(
          parsePatch(oneOffExpensePatch, body, 'One-off expense'),
          now,
          today,
        );
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
      actor: analyticsActor(actor),
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
