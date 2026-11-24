import type { Expense, Pnl, ProviderRow } from '@app/contracts/finance';

/** prd-expenses §8a, November 2026: the seed that the P&L, list and invoice figures come from. */
export const usd = (cents: number) => ({ cents, currency: 'usd' as const });

const stamp = '2026-11-02T10:00:00.000Z';
const uuid = (n: number) => `0193a1b2-0000-7000-8000-${String(n).padStart(12, '0')}`;

interface BillInput {
  n: number;
  name: string;
  vendor: string;
  category: Expense['category'];
  cents: number;
  cadence: 'monthly' | 'yearly';
  startsOn: string;
  nextChargeOn: string;
  covers?: { key: string; name: string };
  link?: string;
}

function bill(i: BillInput): Expense {
  return {
    id: uuid(i.n),
    kind: 'recurring',
    name: i.name,
    vendor: i.vendor,
    category: i.category,
    amount: usd(i.cents),
    cadence: i.cadence,
    startsOn: i.startsOn,
    endsOn: null,
    nextChargeOn: i.nextChargeOn,
    status: 'active',
    coversProvider: i.covers ?? null,
    link: i.link ?? null,
    notes: null,
    monthlyEquivalent: usd(i.cadence === 'yearly' ? Math.round(i.cents / 12) : i.cents),
    versions: [{ effectiveFrom: i.startsOn, amount: usd(i.cents) }],
    chargesInMonth: [{ date: i.startsOn, amount: usd(i.cents) }],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export const ids = {
  digitalOcean: uuid(1),
  resend: uuid(2),
  domain: uuid(3),
  onePassword: uuid(4),
  apify: uuid(5),
  firecrawl: uuid(6),
  legal: uuid(7),
};

export function seedExpenses(): Expense[] {
  return [
    bill({
      n: 1,
      name: 'DigitalOcean App Platform',
      vendor: 'DigitalOcean',
      category: 'hosting',
      cents: 4215,
      cadence: 'monthly',
      startsOn: '2026-11-05',
      nextChargeOn: '2026-12-05',
    }),
    bill({
      n: 2,
      name: 'Resend',
      vendor: 'Resend',
      category: 'email',
      cents: 2000,
      cadence: 'monthly',
      startsOn: '2026-11-18',
      nextChargeOn: '2026-12-18',
      link: 'https://resend.com/settings/billing',
    }),
    bill({
      n: 3,
      name: 'llyner.com',
      vendor: 'Registrar',
      category: 'domain_dns',
      cents: 1499,
      cadence: 'yearly',
      startsOn: '2026-11-02',
      nextChargeOn: '2027-11-02',
    }),
    bill({
      n: 4,
      name: '1Password',
      vendor: '1Password',
      category: 'software_tools',
      cents: 700,
      cadence: 'monthly',
      startsOn: '2026-11-09',
      nextChargeOn: '2026-12-09',
    }),
    bill({
      n: 5,
      name: 'Apify Starter',
      vendor: 'Apify',
      category: 'data_providers',
      cents: 4900,
      cadence: 'monthly',
      startsOn: '2026-11-03',
      nextChargeOn: '2026-12-03',
      covers: { key: 'apify', name: 'Apify' },
    }),
    bill({
      n: 6,
      name: 'Firecrawl Hobby',
      vendor: 'Firecrawl',
      category: 'data_providers',
      cents: 1600,
      cadence: 'monthly',
      startsOn: '2026-11-04',
      nextChargeOn: '2026-12-04',
      covers: { key: 'firecrawl', name: 'Firecrawl' },
    }),
    {
      id: ids.legal,
      kind: 'one_off',
      name: 'Terms and privacy review',
      vendor: 'Counsel',
      category: 'legal_admin',
      amount: usd(30000),
      cadence: null,
      startsOn: '2026-11-12',
      endsOn: null,
      nextChargeOn: null,
      status: 'active',
      coversProvider: null,
      link: null,
      notes: null,
      monthlyEquivalent: null,
      versions: [],
      chargesInMonth: [{ date: '2026-11-12', amount: usd(30000) }],
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
}

export const providers = [
  { key: 'anthropic', name: 'Anthropic', category: 'ai' as const },
  { key: 'apify', name: 'Apify', category: 'data_providers' as const },
  { key: 'firecrawl', name: 'Firecrawl', category: 'data_providers' as const },
  {
    key: 'google-maps-platform',
    name: 'Google Maps Platform',
    category: 'data_providers' as const,
  },
  { key: 'twilio', name: 'Twilio', category: 'data_providers' as const },
  { key: 'zerobounce', name: 'ZeroBounce', category: 'data_providers' as const },
];

const staff = { id: uuid(900), email: 'staff@demo.test' };

function invoiceRow(
  key: string,
  name: string,
  category: 'ai' | 'data_providers',
  metered: number,
  invoice: number | null,
  extra: Partial<ProviderRow> = {},
): ProviderRow {
  const gap =
    invoice !== null && metered > 0
      ? Math.round(((invoice - metered) / metered) * 1000) / 10
      : null;
  return {
    provider: { key, name },
    category,
    metered: usd(metered),
    invoice:
      invoice === null
        ? null
        : { amount: usd(invoice), note: null, enteredAt: stamp, enteredBy: staff },
    plan: null,
    counted: { source: invoice === null ? 'estimate' : 'invoice', amount: usd(invoice ?? metered) },
    gapPct: gap,
    planUsedPct: null,
    flagged: gap !== null && Math.abs(gap) > 15,
    ...extra,
  };
}

export function seedInvoiceRows(): ProviderRow[] {
  return [
    invoiceRow('anthropic', 'Anthropic', 'ai', 3840, 4410),
    invoiceRow('google-maps-platform', 'Google Maps Platform', 'data_providers', 1275, 1720),
    invoiceRow('zerobounce', 'ZeroBounce', 'data_providers', 480, 480),
    invoiceRow('twilio', 'Twilio', 'data_providers', 90, null),
    invoiceRow('apify', 'Apify', 'data_providers', 2210, null, {
      plan: { expenseId: ids.apify, name: 'Apify Starter', amount: usd(4900) },
      counted: { source: 'plan', amount: usd(4900) },
      planUsedPct: 45,
    }),
    invoiceRow('firecrawl', 'Firecrawl', 'data_providers', 320, null, {
      plan: { expenseId: ids.firecrawl, name: 'Firecrawl Hobby', amount: usd(1600) },
      counted: { source: 'plan', amount: usd(1600) },
      planUsedPct: 20,
    }),
  ];
}

export { invoiceRow };

const trendMonths = [
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
  '2026-11',
];

/** The November P&L from FR-9's first acceptance criterion. */
export function novemberPnl(): Pnl {
  return {
    month: '2026-11',
    monthToDate: true,
    revenue: {
      sales: usd(19700),
      salesCount: 3,
      refunds: usd(0),
      net: { cents: 19700, currency: 'usd' },
    },
    costOfRevenue: {
      lines: [
        {
          category: 'payments_fees',
          label: 'Stripe fees (estimated, 2.9% + 30¢ per sale)',
          amount: usd(661),
          source: 'stripe_fees',
        },
        { category: 'ai', label: 'AI', amount: usd(4410), source: 'providers' },
        {
          category: 'data_providers',
          label: 'Data providers',
          amount: usd(8790),
          source: 'providers',
        },
      ],
      total: usd(13861),
    },
    grossProfit: { cents: 5839, currency: 'usd' },
    grossMarginPct: 29.6,
    operating: {
      lines: [
        { category: 'hosting', amount: usd(4215) },
        { category: 'email', amount: usd(2000) },
        { category: 'domain_dns', amount: usd(1499) },
        { category: 'software_tools', amount: usd(700) },
        { category: 'legal_admin', amount: usd(30000) },
      ],
      total: usd(38414),
    },
    netProfit: { cents: -32575, currency: 'usd' },
    totalExpenses: usd(52275),
    categories: [
      { category: 'legal_admin', amount: usd(30000), sharePct: 57.4 },
      { category: 'data_providers', amount: usd(8790), sharePct: 16.8 },
      { category: 'ai', amount: usd(4410), sharePct: 8.4 },
      { category: 'hosting', amount: usd(4215), sharePct: 8.1 },
      { category: 'email', amount: usd(2000), sharePct: 3.8 },
      { category: 'domain_dns', amount: usd(1499), sharePct: 2.9 },
      { category: 'software_tools', amount: usd(700), sharePct: 1.3 },
      { category: 'payments_fees', amount: usd(661), sharePct: 1.3 },
    ],
    yearlyThisMonth: [
      { expenseId: ids.domain, name: 'llyner.com', amount: usd(1499), monthlyEquivalent: usd(125) },
    ],
    fixedRunRate: usd(13540),
    budget: {
      amount: usd(30000),
      spent: usd(52275),
      pct: 174,
      status: 'over',
      alertsSent: [80, 100],
    },
    providerFlags: 1,
    trend: trendMonths.map((month) =>
      month === '2026-11'
        ? {
            month,
            revenue: { cents: 19700, currency: 'usd' as const },
            expenses: usd(52275),
            net: { cents: -32575, currency: 'usd' as const },
          }
        : { month, revenue: null, expenses: null, net: null },
    ),
  };
}

/** A month with nothing in it. */
export function emptyPnl(month: string): Pnl {
  const zero = usd(0);
  const signedZero = { cents: 0, currency: 'usd' as const };
  return {
    month,
    monthToDate: false,
    revenue: { sales: zero, salesCount: 0, refunds: zero, net: signedZero },
    costOfRevenue: { lines: [], total: zero },
    grossProfit: signedZero,
    grossMarginPct: null,
    operating: { lines: [], total: zero },
    netProfit: signedZero,
    totalExpenses: zero,
    categories: [],
    yearlyThisMonth: [],
    fixedRunRate: zero,
    budget: { amount: usd(30000), spent: zero, pct: 0, status: 'under', alertsSent: [] },
    providerFlags: 0,
    trend: trendMonths.map((m) => ({ month: m, revenue: null, expenses: null, net: null })),
  };
}
