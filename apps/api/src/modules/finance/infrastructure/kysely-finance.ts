import type { Kysely, Selectable, Transaction } from 'kysely';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import type {
  BudgetRepository,
  ExpenseRepository,
  FinanceAudit,
  FinanceRepos,
  FinanceStore,
  ProviderInvoiceRepository,
} from '../application/ports.js';
import type { BudgetThreshold } from '../domain/budget.js';
import type { CalendarDay } from '../domain/calendar.js';
import { Expense, type ExpenseSnapshot } from '../domain/expense.js';
import type { InvoiceFact } from '../domain/pnl.js';
import type { ExpensesTable } from './tables.js';

type Db = Kysely<DB> | Transaction<DB>;
type ExpenseRow = Selectable<ExpensesTable>;

/** A DATE column reads as a Date at 00:00 UTC (pool timezone Z). */
const day = (d: Date): CalendarDay => d.toISOString().slice(0, 10);

class KyselyExpenseRepository implements ExpenseRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Expense | null> {
    const row = await this.db
      .selectFrom('expenses')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    return (await this.hydrate([row]))[0] ?? null;
  }

  async listAll(): Promise<Expense[]> {
    const rows = await this.db
      .selectFrom('expenses')
      .selectAll()
      .where('deleted_at', 'is', null)
      .execute();
    return this.hydrate(rows);
  }

  /** Two queries for any number of Expenses (no N+1). */
  private async hydrate(rows: readonly ExpenseRow[]): Promise<Expense[]> {
    if (rows.length === 0) return [];
    const prices = await this.db
      .selectFrom('expense_prices')
      .selectAll()
      .where(
        'expense_id',
        'in',
        rows.map((r) => r.id),
      )
      .orderBy('effective_from')
      .execute();
    return rows.map((r) => {
      const snapshot: ExpenseSnapshot = {
        id: r.id,
        kind: r.kind,
        name: r.name,
        vendor: r.vendor,
        category: r.category,
        cadence: r.cadence,
        startsOn: day(r.starts_on),
        endsOn: r.ends_on ? day(r.ends_on) : null,
        coversProvider: r.covers_provider,
        link: r.link,
        notes: r.notes,
        versions: prices
          .filter((p) => p.expense_id === r.id)
          .map((p) => ({
            id: p.id,
            effectiveFrom: day(p.effective_from),
            amountCents: p.amount_cents,
          })),
        createdByMemberId: r.created_by_member_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        deletedAt: r.deleted_at,
      };
      return Expense.restore(snapshot);
    });
  }

  async save(expense: Expense): Promise<void> {
    const s = expense.toSnapshot();
    const values = {
      kind: s.kind,
      name: s.name,
      vendor: s.vendor,
      category: s.category,
      cadence: s.cadence,
      starts_on: s.startsOn,
      ends_on: s.endsOn,
      covers_provider: s.coversProvider,
      link: s.link,
      notes: s.notes,
      updated_at: s.updatedAt,
      deleted_at: s.deletedAt,
    };
    await this.db
      .insertInto('expenses')
      .values({
        id: s.id,
        ...values,
        created_by_member_id: s.createdByMemberId,
        created_at: s.createdAt,
      })
      .onDuplicateKeyUpdate(values)
      .execute();
    const keep = s.versions.map((v) => v.id);
    let removal = this.db.deleteFrom('expense_prices').where('expense_id', '=', s.id);
    if (keep.length > 0) removal = removal.where('id', 'not in', keep);
    await removal.execute();
    for (const v of s.versions) {
      await this.db
        .insertInto('expense_prices')
        .values({
          id: v.id,
          expense_id: s.id,
          effective_from: v.effectiveFrom,
          amount_cents: v.amountCents,
        })
        .onDuplicateKeyUpdate({ effective_from: v.effectiveFrom, amount_cents: v.amountCents })
        .execute();
    }
  }
}

class KyselyProviderInvoiceRepository implements ProviderInvoiceRepository {
  constructor(private readonly db: Db) {}

  async forMonths(months: readonly string[]): Promise<InvoiceFact[]> {
    if (months.length === 0) return [];
    const rows = await this.db
      .selectFrom('provider_invoices')
      .selectAll()
      .where('month', 'in', [...months])
      .execute();
    return rows.map(toInvoice);
  }

  async find(provider: string, month: string): Promise<InvoiceFact | null> {
    const row = await this.db
      .selectFrom('provider_invoices')
      .selectAll()
      .where('provider', '=', provider)
      .where('month', '=', month)
      .executeTakeFirst();
    return row ? toInvoice(row) : null;
  }

  async save(invoice: InvoiceFact, now: Date): Promise<void> {
    const changes = {
      amount_cents: invoice.amountCents,
      note: invoice.note,
      entered_by_member_id: invoice.enteredByMemberId,
      entered_at: invoice.enteredAt,
      updated_at: now,
    };
    await this.db
      .insertInto('provider_invoices')
      .values({ provider: invoice.provider, month: invoice.month, ...changes })
      .onDuplicateKeyUpdate(changes)
      .execute();
  }

  async delete(provider: string, month: string): Promise<void> {
    await this.db
      .deleteFrom('provider_invoices')
      .where('provider', '=', provider)
      .where('month', '=', month)
      .execute();
  }
}

function toInvoice(r: {
  provider: string;
  month: string;
  amount_cents: number;
  note: string | null;
  entered_at: Date;
  entered_by_member_id: string;
}): InvoiceFact {
  return {
    provider: r.provider,
    month: r.month,
    amountCents: r.amount_cents,
    note: r.note,
    enteredAt: r.entered_at,
    enteredByMemberId: r.entered_by_member_id,
  };
}

const DEFAULT_BUDGET_CENTS = 30000;

class KyselyBudgetRepository implements BudgetRepository {
  constructor(private readonly db: Db) {}

  async settings() {
    const row = await this.db
      .selectFrom('finance_settings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst();
    return {
      monthlyBudgetCents: row?.monthly_budget_cents ?? DEFAULT_BUDGET_CENTS,
      updatedByMemberId: row?.updated_by_member_id ?? null,
      updatedAt: row?.updated_at ?? new Date(0),
    };
  }

  async saveSettings(s: {
    monthlyBudgetCents: number;
    updatedByMemberId: string | null;
    updatedAt: Date;
  }) {
    const values = {
      monthly_budget_cents: s.monthlyBudgetCents,
      updated_by_member_id: s.updatedByMemberId,
      updated_at: s.updatedAt,
    };
    await this.db
      .insertInto('finance_settings')
      .values({ id: 1, ...values })
      .onDuplicateKeyUpdate(values)
      .execute();
  }

  async snapshot(month: string): Promise<number | null> {
    const row = await this.db
      .selectFrom('finance_budgets')
      .select('budget_cents')
      .where('month', '=', month)
      .executeTakeFirst();
    return row?.budget_cents ?? null;
  }

  async saveSnapshot(
    month: string,
    budgetCents: number,
    at: Date,
    replace: boolean,
  ): Promise<void> {
    const insert = this.db
      .insertInto('finance_budgets')
      .values({ month, budget_cents: budgetCents, set_at: at });
    await (
      replace
        ? insert.onDuplicateKeyUpdate({ budget_cents: budgetCents, set_at: at })
        : insert.ignore()
    ).execute();
  }

  async alertsSent(month: string): Promise<BudgetThreshold[]> {
    const rows = await this.db
      .selectFrom('budget_alerts')
      .select('threshold')
      .where('month', '=', month)
      .orderBy('threshold')
      .execute();
    return rows.map((r) => (Number(r.threshold) === 100 ? 100 : 80));
  }
}

const repos = (db: Db) => ({
  expenses: new KyselyExpenseRepository(db),
  invoices: new KyselyProviderInvoiceRepository(db),
  budgets: new KyselyBudgetRepository(db),
});

/** finance's tables on MySQL. A unit of work is one transaction, with its Audit entries. */
export class KyselyFinanceStore implements FinanceStore {
  readonly read: Omit<FinanceRepos, 'audit'>;

  constructor(
    private readonly db: Kysely<DB>,
    private readonly audit: FinanceAudit,
  ) {
    this.read = repos(db);
  }

  run<T>(fn: (repos: FinanceRepos) => Promise<T>): Promise<T> {
    return this.db
      .transaction()
      .execute((trx) =>
        fn({ ...repos(trx), audit: { record: (entry) => this.audit.record(entry, trx) } }),
      );
  }
}
