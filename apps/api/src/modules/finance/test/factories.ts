import type { CalendarDay } from '../domain/calendar.js';
import type { Category } from '../domain/categories.js';
import { Expense, type Cadence } from '../domain/expense.js';
import type { InvoiceFact, MonthData, Sale } from '../domain/pnl.js';

/** The fixed "now" of every finance test (prd-expenses section 11). */
export const NOW = new Date('2026-11-20T12:00:00.000Z');
export const TODAY = '2026-11-20';
export const STAFF_ID = '00000000-0000-4000-8000-0000000000aa';

let counter = 0;
const nextId = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
};

interface BillOptions {
  cadence?: Cadence;
  endsOn?: CalendarDay | null;
  coversProvider?: string | null;
  /** Extra price versions after the first. */
  prices?: readonly { effectiveFrom: CalendarDay; amountCents: number }[];
  id?: string;
}

/** A Recurring bill as it would be restored from the database. */
export function bill(
  name: string,
  category: Category,
  amountCents: number,
  startsOn: CalendarDay,
  options: BillOptions = {},
): Expense {
  return Expense.restore({
    id: options.id ?? nextId(),
    kind: 'recurring',
    name,
    vendor: name,
    category,
    cadence: options.cadence ?? 'monthly',
    startsOn,
    endsOn: options.endsOn ?? null,
    coversProvider: options.coversProvider ?? null,
    link: null,
    notes: null,
    versions: [
      { id: nextId(), effectiveFrom: startsOn, amountCents },
      ...(options.prices ?? []).map((p) => ({ id: nextId(), ...p })),
    ],
    createdByMemberId: STAFF_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });
}

export function oneOff(
  name: string,
  category: Category,
  amountCents: number,
  spentOn: CalendarDay,
): Expense {
  return Expense.restore({
    id: nextId(),
    kind: 'one_off',
    name,
    vendor: name,
    category,
    cadence: null,
    startsOn: spentOn,
    endsOn: null,
    coversProvider: null,
    link: null,
    notes: null,
    versions: [{ id: nextId(), effectiveFrom: spentOn, amountCents }],
    createdByMemberId: STAFF_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });
}

export const sale = (amountCents: number, paidAt = '2026-11-10T10:00:00Z', taxCents = 0): Sale => ({
  purchaseId: nextId(),
  amountCents,
  taxCents,
  paidAt: new Date(paidAt),
});

export const invoice = (provider: string, amountCents: number, month = '2026-11'): InvoiceFact => ({
  provider,
  month,
  amountCents,
  note: null,
  enteredAt: NOW,
  enteredByMemberId: STAFF_ID,
});

/** micros for a cents amount. */
export const centsToMicros = (cents: number) => cents * 10_000;

/** prd-expenses section 8a: the seeded bills and One-off. */
export function seededExpenses(): Expense[] {
  return [
    bill('DigitalOcean App Platform', 'hosting', 4215, '2026-11-05'),
    bill('Resend', 'email', 2000, '2026-11-18'),
    bill('llyner.com', 'domain_dns', 1499, '2026-11-02', { cadence: 'yearly' }),
    bill('1Password', 'software_tools', 700, '2026-11-09'),
    bill('Apify Starter', 'data_providers', 4900, '2026-11-03', { coversProvider: 'Apify' }),
    bill('Firecrawl Hobby', 'data_providers', 1600, '2026-11-04', { coversProvider: 'Firecrawl' }),
    oneOff('Terms and privacy review', 'legal_admin', 30000, '2026-11-12'),
  ];
}

/** prd-expenses section 8a: November's sales, metered usage and invoices. */
export function seededNovember(): MonthData {
  return {
    sales: [
      sale(4900, '2026-11-06T15:00:00Z'),
      sale(4900, '2026-11-11T15:00:00Z'),
      sale(9900, '2026-11-16T15:00:00Z'),
    ],
    refunds: [],
    metered: [
      { provider: 'Anthropic', micros: centsToMicros(3840) },
      { provider: 'Google Maps Platform', micros: centsToMicros(1275) },
      { provider: 'ZeroBounce', micros: centsToMicros(480) },
      { provider: 'Twilio', micros: centsToMicros(90) },
      { provider: 'Apify', micros: centsToMicros(2210) },
      { provider: 'Firecrawl', micros: centsToMicros(320) },
    ],
    invoices: [
      invoice('Anthropic', 4410),
      invoice('Google Maps Platform', 1720),
      invoice('ZeroBounce', 480),
    ],
  };
}
