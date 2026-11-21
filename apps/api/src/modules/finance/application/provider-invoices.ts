import type { ProviderRow, SaveInvoiceBody } from '@app/contracts/finance';
import type { Actor } from '../../../shared/domain/actor.js';
import { CodedError } from '../../../shared/domain/errors.js';
import type { MonthKey } from '../domain/calendar.js';
import { providerCategoryOf } from '../domain/categories.js';
import { providerLines, type ProviderLine } from '../domain/pnl.js';
import type { FinanceContext } from './ports.js';
import { catalogProviders, providerByKey, requireStaff, resolveMonth, todayOf } from './rules.js';
import { Statements } from './statements.js';
import { memberEmails, money, providerRowView } from './views.js';

type Ctx = Pick<FinanceContext, 'store' | 'billing' | 'tools' | 'members' | 'analytics' | 'clock'>;

/** FR-6: the catalog's providers for the "covers usage of" picker. */
export class ListProviders {
  constructor(private readonly ctx: Pick<FinanceContext, 'tools'>) {}

  async execute(caller: Actor | null) {
    requireStaff(caller);
    return { items: await catalogProviders(this.ctx.tools) };
  }
}

async function linesFor(ctx: Ctx, month: MonthKey): Promise<ProviderLine[]> {
  const statements = new Statements(ctx);
  const [expenses, data] = await Promise.all([
    statements.expenses(),
    statements.monthData([month]),
  ]);
  const d = data.get(month);
  return providerLines({
    month,
    today: todayOf(ctx.clock),
    expenses,
    metered: d?.metered ?? [],
    invoices: d?.invoices ?? [],
  });
}

/** The provider's row for the month, or an empty estimate row when nothing applies any more. */
async function rowFor(ctx: Ctx, providerName: string, month: MonthKey): Promise<ProviderRow> {
  const line =
    (await linesFor(ctx, month)).find((l) => l.provider === providerName) ??
    ({
      provider: providerName,
      category: providerCategoryOf(providerName),
      meteredCents: 0,
      invoice: null,
      plan: null,
      counted: { source: 'estimate', amountCents: 0, category: providerCategoryOf(providerName) },
      gapPct: null,
      planUsedPct: null,
      flagged: false,
    } satisfies ProviderLine);
  const staff = await memberEmails(ctx.members, [line.invoice?.enteredByMemberId ?? null]);
  return providerRowView(line, staff);
}

/** FR-8: each provider's metered cost, invoice or plan, the amount counted and the gap flags. */
export class ListProviderInvoices {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null, query: { month?: MonthKey }) {
    requireStaff(caller);
    const month = resolveMonth(query.month, this.ctx.clock);
    const lines = await linesFor(this.ctx, month);
    const staff = await memberEmails(
      this.ctx.members,
      lines.map((l) => l.invoice?.enteredByMemberId ?? null),
    );
    return {
      month,
      rows: lines.map((l) => providerRowView(l, staff)),
      totals: {
        metered: money(lines.reduce((s, l) => s + l.meteredCents, 0)),
        counted: money(lines.reduce((s, l) => s + l.counted.amountCents, 0)),
      },
      flaggedCount: lines.filter((l) => l.flagged).length,
    };
  }
}

const target = (key: string, month: MonthKey) => `${key}:${month}`;

/** FR-8: enter (or replace) a provider's invoice for a month. */
export class SaveProviderInvoice {
  constructor(private readonly ctx: Ctx) {}

  async execute(
    caller: Actor | null,
    key: string,
    month: MonthKey,
    body: SaveInvoiceBody,
  ): Promise<ProviderRow> {
    const actor = requireStaff(caller);
    resolveMonth(month, this.ctx.clock);
    const provider = await providerByKey(this.ctx.tools, key);
    const now = this.ctx.clock.now();
    await this.ctx.store.run(async (repos) => {
      const before = await repos.invoices.find(provider.name, month);
      const note = body.note === undefined || body.note === '' ? null : body.note;
      await repos.invoices.save(
        {
          provider: provider.name,
          month,
          amountCents: body.amountCents,
          note,
          enteredAt: now,
          enteredByMemberId: actor.memberId,
        },
        now,
      );
      await repos.audit.record({
        staffMemberId: actor.memberId,
        businessId: null,
        action: 'provider_invoice.saved',
        targetType: 'provider_invoice',
        targetId: target(key, month),
        details: {
          provider: provider.name,
          month,
          amountCents: { from: before?.amountCents ?? null, to: body.amountCents },
          note: { from: before?.note ?? null, to: note },
        },
      });
    });
    const row = await rowFor(this.ctx, provider.name, month);
    await this.ctx.analytics.track({
      name: 'provider_invoice_entered',
      actor: { memberId: actor.memberId, businessId: actor.businessId },
      properties: {
        provider: key,
        month,
        metered_cents: row.metered.cents,
        invoice_cents: body.amountCents,
        gap_pct: row.gapPct,
        flagged: row.flagged,
      },
    });
    return row;
  }
}

/** FR-8: delete a provider's invoice; the row reverts to the plan or the estimate. */
export class DeleteProviderInvoice {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null, key: string, month: MonthKey): Promise<ProviderRow> {
    const actor = requireStaff(caller);
    resolveMonth(month, this.ctx.clock);
    const provider = await providerByKey(this.ctx.tools, key);
    await this.ctx.store.run(async (repos) => {
      const before = await repos.invoices.find(provider.name, month);
      if (!before) {
        throw new CodedError(
          'NO_INVOICE',
          'No invoice for this provider and month',
          { provider: key, month },
          404,
        );
      }
      await repos.invoices.delete(provider.name, month);
      await repos.audit.record({
        staffMemberId: actor.memberId,
        businessId: null,
        action: 'provider_invoice.deleted',
        targetType: 'provider_invoice',
        targetId: target(key, month),
        details: {
          provider: provider.name,
          month,
          amountCents: { from: before.amountCents, to: null },
          note: { from: before.note, to: null },
        },
      });
    });
    return rowFor(this.ctx, provider.name, month);
  }
}
