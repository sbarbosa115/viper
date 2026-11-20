import { z } from 'zod';
import {
  credits,
  defineContract,
  email,
  err,
  id,
  idParams,
  isoDate,
  isoDateTime,
  listQuery,
  money,
  page,
} from './common.js';
import { runFailureCode } from './errors.js';

// Dashboard (FR-30) --------------------------------------------------------------------------------

export const dashboardPeriod = z.enum(['7d', '30d', '90d']);
export type DashboardPeriod = z.infer<typeof dashboardPeriod>;

/** A headline number for the period and the previous period; null = no data ("—"). */
export const metric = z.object({ value: z.number().nullable(), previous: z.number().nullable() });
export type Metric = z.infer<typeof metric>;

export const moneyMetric = z.object({ value: money.nullable(), previous: money.nullable() });
export type MoneyMetric = z.infer<typeof moneyMetric>;

export const dashboard = z.object({
  period: dashboardPeriod,
  /** Excludes Staff's own and internal Businesses. */
  customers: z.object({
    total: metric,
    newSignups: metric.extend({
      byDay: z.array(z.object({ date: isoDate, count: z.int().nonnegative() })),
    }),
    verified: metric,
    active: metric,
    paying: metric,
    trialToPaidPct: metric,
  }),
  /** Excludes Staff's own and internal Businesses. */
  revenue: z.object({
    packRevenue: moneyMetric,
    creditsGranted: metric,
    creditsPurchased: metric,
    creditsSpent: metric,
    unspentCredits: metric,
  }),
  runs: z.object({
    started: metric,
    completedPct: metric,
    withinLimitsPct: metric,
    medianDurationS: metric,
    avgCredits: metric,
    failed: z.array(
      z.object({
        runId: id,
        businessName: z.string(),
        failureReason: runFailureCode.nullable(),
        at: isoDateTime,
      }),
    ),
  }),
  leads: z.object({
    delivered: metric,
    goodPct: metric,
    verifiedPct: metric,
    providerCostPerLeadCents: metric,
    creditsPerLead: metric,
    grossMarginPct: metric,
  }),
  plans: z.object({ noIcpEditPct: metric }),
  northStar: z.object({ goodLeadsPerActiveBusinessPerWeek: metric }),
  providers: z.array(
    z.object({
      toolKey: z.string(),
      spendCents: z.number().nonnegative(),
      errorRatePct: z.number().min(0).max(100).nullable(),
    }),
  ),
  topBusinesses: z.array(z.object({ id, name: z.string(), creditsSpent: credits })),
  latestSignups: z.array(
    z.object({ id, name: z.string(), ownerEmail: email, createdAt: isoDateTime }),
  ),
});
export type Dashboard = z.infer<typeof dashboard>;

export const getDashboard = defineContract({
  method: 'GET',
  path: '/api/staff/dashboard',
  auth: 'staff',
  status: 200,
  query: z.object({ period: dashboardPeriod.default('30d') }),
  response: dashboard,
});

// Customer list (FR-31) ----------------------------------------------------------------------------

export const customer = z.object({
  id,
  name: z.string(),
  ownerEmail: email,
  signedUpAt: isoDateTime,
  verified: z.boolean(),
  availableCredits: credits,
  runs: z.int().nonnegative(),
  leadsDelivered: z.int().nonnegative(),
  lastActiveAt: isoDateTime.nullable(),
  paying: z.boolean(),
  internal: z.boolean(),
});
export type Customer = z.infer<typeof customer>;

export const listCustomers = defineContract({
  method: 'GET',
  path: '/api/staff/businesses',
  auth: 'staff',
  status: 200,
  query: listQuery(50).extend({
    /** Business name or Owner email. */
    q: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['signedUp', 'lastActive']).default('signedUp'),
  }),
  response: page(customer),
});

/** Mark a Business internal (excluded from customer and revenue tiles). */
export const updateCustomer = defineContract({
  method: 'PATCH',
  path: '/api/staff/businesses/:id',
  auth: 'staff',
  status: 200,
  params: idParams,
  body: z.object({ internal: z.boolean() }),
  response: customer,
  errors: [err(404, 'NOT_FOUND')],
});

export const reportingContracts = { getDashboard, listCustomers, updateCustomer } as const;
