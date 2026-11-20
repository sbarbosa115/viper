import { z } from 'zod';
import {
  credits,
  defineContract,
  err,
  id,
  idParams,
  isoDateTime,
  listQuery,
  source,
} from './common.js';

// Shapes -----------------------------------------------------------------------------------------

export const feedbackValue = z.enum(['good', 'not_fit']);
export type FeedbackValue = z.infer<typeof feedbackValue>;

export const fitScore = z.int().min(0).max(100);

export const leadSummary = z.object({
  id,
  name: z.string(),
  category: z.string().nullable(),
  distanceMiles: z.number().nonnegative().nullable(),
  fitScore,
  /** Which kinds of Contact the Lead has (list icons). */
  contacts: z.object({
    phone: z.boolean(),
    email: z.boolean(),
    website: z.boolean(),
    instagram: z.boolean(),
    tiktok: z.boolean(),
  }),
  feedback: feedbackValue.nullable(),
  runId: id,
  deliveredAt: isoDateTime,
});
export type LeadSummary = z.infer<typeof leadSummary>;

export const contactType = z.enum([
  'phone',
  'email',
  'website',
  'instagram',
  'tiktok',
  'yelp',
  'facebook',
]);
export type ContactType = z.infer<typeof contactType>;

export const contact = z.object({
  type: contactType,
  value: z.string(),
  label: z.string().nullable(),
  verification: z.enum(['verified', 'unverified']),
  source,
});
export type Contact = z.infer<typeof contact>;

export const evidence = z.object({
  fact: z.string().max(300),
  points: z.int().min(-30).max(40),
  source,
});
export type Evidence = z.infer<typeof evidence>;

export const lead = leadSummary.extend({
  address: z.string().nullable(),
  contacts: z.array(contact),
  evidence: z.array(evidence),
  pitch: z.object({ productId: id.nullable(), productName: z.string(), reason: z.string() }),
  feedbackReason: z.string().nullable(),
  planId: id,
});
export type Lead = z.infer<typeof lead>;

/** Lead list filters (FR-26), shared by the list and the CSV export (FR-28). */
export const leadFilters = z.object({
  runId: id.optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  /** Omitted = all; `none` = no Feedback yet. */
  feedback: z.enum(['good', 'not_fit', 'none']).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  sort: z.enum(['score', 'distance', 'newest']).default('score'),
});
export type LeadFilters = z.infer<typeof leadFilters>;

export const leadListStats = z.object({
  total: z.int().nonnegative(),
  avgFitScore: z.number().min(0).max(100).nullable(),
  verifiedPct: z.number().min(0).max(100).nullable(),
  creditsSpent: credits,
  costPerLead: z.number().nonnegative().nullable(),
});
export type LeadListStats = z.infer<typeof leadListStats>;

/** The CSV columns, in order (FR-28). */
export const leadCsvColumns = [
  'business_name',
  'category',
  'address',
  'distance_miles',
  'phone',
  'phone_verified',
  'email',
  'email_verified',
  'website',
  'instagram',
  'tiktok',
  'yelp',
  'fit_score',
  'pitch_product',
  'pitch_reason',
  'feedback',
  'sources',
  'delivered_at',
] as const;

// Endpoints --------------------------------------------------------------------------------------

export const listLeads = defineContract({
  method: 'GET',
  path: '/api/plans/:id/leads',
  auth: 'session',
  status: 200,
  params: idParams,
  query: listQuery(50).extend(leadFilters.shape),
  response: z.object({
    items: z.array(leadSummary),
    nextCursor: z.string().nullable(),
    stats: leadListStats,
  }),
  errors: [err(404, 'NOT_FOUND')],
});

export const getLead = defineContract({
  method: 'GET',
  path: '/api/leads/:id',
  auth: 'session',
  status: 200,
  params: idParams,
  response: lead,
  errors: [err(404, 'NOT_FOUND')],
});

/** FR-27. `value: null` clears the Feedback. */
export const setLeadFeedback = defineContract({
  method: 'PUT',
  path: '/api/leads/:id/feedback',
  auth: 'session',
  status: 200,
  params: idParams,
  body: z.object({
    value: feedbackValue.nullable(),
    reason: z.string().trim().max(200).optional(),
  }),
  response: lead,
  errors: [err(404, 'NOT_FOUND')],
});

/** FR-28. Streamed UTF-8 CSV, `Content-Disposition: attachment; filename="llyner-leads-<slug>-<date>.csv"`. */
export const exportLeadsCsv = defineContract({
  method: 'GET',
  path: '/api/plans/:id/leads.csv',
  auth: 'session',
  status: 200,
  params: idParams,
  query: leadFilters,
  contentType: 'text/csv',
  response: z.string(),
  errors: [err(404, 'NOT_FOUND')],
});

export const leadsContracts = { listLeads, getLead, setLeadFeedback, exportLeadsCsv } as const;
