import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import type {
  BillingRevenue,
  BudgetRepository,
  BudgetSettings,
  ExpenseRepository,
  FinanceAudit,
  FinanceAuditRecord,
  FinanceContext,
  FinanceRepos,
  FinanceStore,
  MemberDirectory,
  ProviderInvoiceRepository,
  StaffDirectory,
  StaffRecipient,
  ToolsMetering,
} from '../application/ports.js';
import type { BudgetThreshold } from '../domain/budget.js';
import { monthOfInstant, type MonthKey } from '../domain/calendar.js';
import { Expense, type ExpenseSnapshot } from '../domain/expense.js';
import type { InvoiceFact } from '../domain/pnl.js';
import { NOW, STAFF_ID } from './factories.js';

export const staffActor: Actor = {
  memberId: STAFF_ID,
  businessId: '00000000-0000-4000-8000-000000000001',
  roles: ['owner', 'staff'],
  emailVerified: true,
};

export const ownerActor: Actor = {
  memberId: '00000000-0000-4000-8000-0000000000bb',
  businessId: '00000000-0000-4000-8000-000000000003',
  roles: ['owner'],
  emailVerified: true,
};

export const STAFF_EMAIL = 'staff@demo.test';

/** The Tool catalog's providers (tools' TOOL_CATALOG), with sample keys. */
export const CATALOG: { name: string; toolKeys: string[] }[] = [
  { name: 'Google Maps Platform', toolKeys: ['google.places', 'google.geocoding'] },
  { name: 'Apify', toolKeys: ['apify.google_maps', 'apify.instagram', 'apify.yelp'] },
  { name: 'OpenStreetMap', toolKeys: ['osm.overpass'] },
  { name: 'Firecrawl', toolKeys: ['firecrawl.scrape'] },
  { name: 'Apollo', toolKeys: ['apollo.organization', 'apollo.people'] },
  { name: 'Hunter', toolKeys: ['hunter.domain_search'] },
  { name: 'ZeroBounce', toolKeys: ['zerobounce.validate'] },
  { name: 'Twilio', toolKeys: ['twilio.lookup'] },
  { name: 'Anthropic', toolKeys: ['anthropic.input', 'anthropic.output'] },
];

export interface FakePurchase {
  purchaseId: string;
  amountCents: number;
  taxCents: number;
  status: 'pending' | 'paid' | 'failed';
  paidAt: Date | null;
  refundedCents: number;
  refundedAt: Date | null;
}

/** billing's revenueForMonth over a list of Purchases, as billing answers it. */
export class FakeBillingRevenue implements BillingRevenue {
  readonly purchases: FakePurchase[] = [];
  calls = 0;

  add(p: Partial<FakePurchase> & { amountCents: number; paidAt: Date | null }): this {
    this.purchases.push({
      purchaseId: `00000000-0000-4000-8000-${(0xb000 + this.purchases.length).toString(16).padStart(12, '0')}`,
      taxCents: 0,
      status: 'paid',
      refundedCents: 0,
      refundedAt: null,
      ...p,
    });
    return this;
  }

  revenueForMonth(month: MonthKey) {
    this.calls += 1;
    const inMonth = (d: Date | null) => d !== null && monthOfInstant(d) === month;
    return Promise.resolve({
      sales: this.purchases
        .filter((p) => p.status === 'paid' && inMonth(p.paidAt))
        .map((p) => ({
          purchaseId: p.purchaseId,
          amountCents: p.amountCents,
          taxCents: p.taxCents,
          paidAt: p.paidAt!,
        })),
      refunds: this.purchases
        .filter((p) => p.refundedCents > 0 && inMonth(p.refundedAt))
        .map((p) => ({
          purchaseId: p.purchaseId,
          refundedCents: p.refundedCents,
          amountCents: p.amountCents,
          taxCents: p.taxCents,
          refundedAt: p.refundedAt!,
        })),
    });
  }
}

/** tools' metered cost: Tool calls by key and time, summed per catalog provider. */
export class FakeToolsMetering implements ToolsMetering {
  readonly calls: { toolKey: string; micros: number; at: Date }[] = [];

  add(provider: string, micros: number, at = new Date('2026-11-10T10:00:00Z')): this {
    const key = CATALOG.find((p) => p.name === provider)?.toolKeys[0] ?? provider;
    this.calls.push({ toolKey: key, micros, at });
    return this;
  }

  meteredCostByProvider(month: MonthKey) {
    const totals = new Map<string, number>();
    for (const c of this.calls) {
      if (monthOfInstant(c.at) !== month) continue;
      const provider = CATALOG.find((p) => p.toolKeys.includes(c.toolKey))?.name ?? c.toolKey;
      totals.set(provider, (totals.get(provider) ?? 0) + c.micros);
    }
    return Promise.resolve([...totals].map(([provider, micros]) => ({ provider, micros })));
  }

  providers() {
    return Promise.resolve(CATALOG.map((p) => ({ ...p, toolKeys: [...p.toolKeys] })));
  }
}

export class FakeStaffDirectory implements StaffDirectory, MemberDirectory {
  readonly staff: StaffRecipient[] = [
    { memberId: STAFF_ID, email: STAFF_EMAIL, name: 'Sam Staff' },
  ];
  staffRecipients() {
    return Promise.resolve([...this.staff]);
  }
  memberEmails(ids: readonly string[]) {
    return Promise.resolve(
      new Map(this.staff.filter((s) => ids.includes(s.memberId)).map((s) => [s.memberId, s.email])),
    );
  }
}

export class RecordingAudit implements FinanceAudit {
  readonly entries: FinanceAuditRecord[] = [];
  record(entry: FinanceAuditRecord): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
}

/**
 * finance's tables in memory. `run` works on a copy and commits it when the function returns, so
 * a thrown error leaves nothing behind (like the MySQL transaction).
 */
export class InMemoryFinanceStore implements FinanceStore {
  expenses = new Map<string, ExpenseSnapshot>();
  invoices = new Map<string, InvoiceFact>();
  settings: BudgetSettings = { monthlyBudgetCents: 30000, updatedByMemberId: null, updatedAt: NOW };
  snapshots = new Map<MonthKey, number>();
  alerts = new Map<MonthKey, BudgetThreshold[]>();

  constructor(private readonly audit: FinanceAudit = new RecordingAudit()) {}

  get read(): Omit<FinanceRepos, 'audit'> {
    return this.repos(this);
  }

  async run<T>(fn: (repos: FinanceRepos) => Promise<T>): Promise<T> {
    const draft = Object.assign(
      Object.create(InMemoryFinanceStore.prototype) as InMemoryFinanceStore,
      {
        expenses: new Map(this.expenses),
        invoices: new Map(this.invoices),
        settings: { ...this.settings },
        snapshots: new Map(this.snapshots),
        alerts: new Map(this.alerts),
      },
    );
    const pending: FinanceAuditRecord[] = [];
    const result = await fn({
      ...this.repos(draft),
      audit: {
        record: (entry) => {
          pending.push(entry);
          return Promise.resolve();
        },
      },
    });
    Object.assign(this, {
      expenses: draft.expenses,
      invoices: draft.invoices,
      settings: draft.settings,
      snapshots: draft.snapshots,
      alerts: draft.alerts,
    });
    for (const entry of pending) await this.audit.record(entry);
    return result;
  }

  add(...expenses: Expense[]): this {
    for (const e of expenses) this.expenses.set(e.id, e.toSnapshot());
    return this;
  }

  private repos(state: InMemoryFinanceStore): Omit<FinanceRepos, 'audit'> {
    const expenses: ExpenseRepository = {
      findById: (id) => {
        const s = state.expenses.get(id);
        return Promise.resolve(s && !s.deletedAt ? Expense.restore(s) : null);
      },
      listAll: () =>
        Promise.resolve(
          [...state.expenses.values()].filter((s) => !s.deletedAt).map((s) => Expense.restore(s)),
        ),
      save: (e) => {
        state.expenses.set(e.id, e.toSnapshot());
        return Promise.resolve();
      },
    };
    const key = (provider: string, month: string) => `${provider}|${month}`;
    const invoices: ProviderInvoiceRepository = {
      forMonths: (months) =>
        Promise.resolve([...state.invoices.values()].filter((i) => months.includes(i.month))),
      find: (provider, month) => Promise.resolve(state.invoices.get(key(provider, month)) ?? null),
      save: (invoice) => {
        state.invoices.set(key(invoice.provider, invoice.month), invoice);
        return Promise.resolve();
      },
      delete: (provider, month) => {
        state.invoices.delete(key(provider, month));
        return Promise.resolve();
      },
    };
    const budgets: BudgetRepository = {
      settings: () => Promise.resolve({ ...state.settings }),
      saveSettings: (s) => {
        state.settings = { ...s };
        return Promise.resolve();
      },
      snapshot: (month) => Promise.resolve(state.snapshots.get(month) ?? null),
      saveSnapshot: (month, cents, _at, replace) => {
        if (replace || !state.snapshots.has(month)) state.snapshots.set(month, cents);
        return Promise.resolve();
      },
      alertsSent: (month) => Promise.resolve([...(state.alerts.get(month) ?? [])]),
      insertAlert: (month, threshold) => {
        const sent = state.alerts.get(month) ?? [];
        if (sent.includes(threshold)) return Promise.resolve(false);
        state.alerts.set(
          month,
          [...sent, threshold].sort((a, b) => a - b),
        );
        return Promise.resolve(true);
      },
      clearAlerts: (month) => {
        state.alerts.delete(month);
        return Promise.resolve();
      },
    };
    return { expenses, invoices, budgets };
  }
}

export interface FakeWorld {
  ctx: FinanceContext;
  store: InMemoryFinanceStore;
  audit: RecordingAudit;
  analytics: RecordingAnalyticsTracker;
  billing: FakeBillingRevenue;
  tools: FakeToolsMetering;
  staff: FakeStaffDirectory;
  clock: FixedClock;
}

/** Everything finance needs, in memory, with the clock at 2026-11-20T12:00:00Z. */
export function fakeWorld(now: Date = NOW): FakeWorld {
  const audit = new RecordingAudit();
  const store = new InMemoryFinanceStore(audit);
  const analytics = new RecordingAnalyticsTracker();
  const billing = new FakeBillingRevenue();
  const tools = new FakeToolsMetering();
  const staff = new FakeStaffDirectory();
  const clock = new FixedClock(now);
  return {
    ctx: {
      store,
      clock,
      ids: new SequentialIdGenerator(),
      analytics,
      billing,
      tools,
      staff,
      members: staff,
    },
    store,
    audit,
    analytics,
    billing,
    tools,
    staff,
    clock,
  };
}

/** prd-expenses section 8a: November's purchases and metered Tool calls. */
export function seedNovemberSources(world: Pick<FakeWorld, 'billing' | 'tools'>): void {
  world.billing
    .add({ amountCents: 4900, paidAt: new Date('2026-11-06T15:00:00Z') })
    .add({ amountCents: 4900, paidAt: new Date('2026-11-11T15:00:00Z') })
    .add({ amountCents: 9900, paidAt: new Date('2026-11-16T15:00:00Z') });
  world.tools
    .add('Anthropic', 38_400_000)
    .add('Google Maps Platform', 12_750_000)
    .add('ZeroBounce', 4_800_000)
    .add('Twilio', 900_000)
    .add('Apify', 22_100_000)
    .add('Firecrawl', 3_200_000);
}
