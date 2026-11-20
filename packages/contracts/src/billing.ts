import { z } from 'zod';
import {
  credits,
  defineContract,
  err,
  id,
  idParams,
  isoDateTime,
  listQuery,
  money,
  page,
} from './common.js';

// Shapes -----------------------------------------------------------------------------------------

export const ledgerEntryType = z.enum([
  'grant',
  'purchase',
  'reservation',
  'release',
  'settlement',
  'adjustment',
]);
export type LedgerEntryType = z.infer<typeof ledgerEntryType>;

export const ledgerEntry = z.object({
  id,
  type: ledgerEntryType,
  /** Signed: positive adds credits, negative removes them. */
  credits,
  description: z.string(),
  runId: id.nullable(),
  createdAt: isoDateTime,
});
export type LedgerEntry = z.infer<typeof ledgerEntry>;

/** A Credit pack as customers see it. */
export const packOffer = z.object({
  id,
  name: z.string(),
  credits: z.int().positive(),
  price: money,
});
export type PackOffer = z.infer<typeof packOffer>;

/** A Credit pack as Staff manage it (FR-13). */
export const creditPack = z.object({
  id,
  name: z.string(),
  credits: z.int().min(1).max(1_000_000),
  priceCents: z.int().min(50).max(1_000_000),
  active: z.boolean(),
});
export type CreditPack = z.infer<typeof creditPack>;

export const creditPackInput = creditPack.omit({ id: true }).extend({
  name: z.string().trim().min(1).max(60),
});
export type CreditPackInput = z.infer<typeof creditPackInput>;

export const creditWallet = z.object({
  balance: credits,
  reserved: z.int().nonnegative(),
  available: credits,
  packs: z.array(packOffer),
  paymentsAvailable: z.boolean(),
});
export type CreditWallet = z.infer<typeof creditWallet>;

// Endpoints --------------------------------------------------------------------------------------

/** FR-10. */
export const getCredits = defineContract({
  method: 'GET',
  path: '/api/credits',
  auth: 'session',
  status: 200,
  response: creditWallet,
});

/** FR-10. Newest first, 25 per page. */
export const listLedger = defineContract({
  method: 'GET',
  path: '/api/credits/ledger',
  auth: 'session',
  status: 200,
  query: listQuery(25),
  response: page(ledgerEntry),
});

/** FR-12. Owner, verified, not Acting as. */
export const createCheckout = defineContract({
  method: 'POST',
  path: '/api/credits/checkout',
  auth: 'session',
  status: 200,
  body: z.object({ packId: id }),
  response: z.object({ checkoutUrl: z.url() }),
  errors: [
    err(403, 'EMAIL_NOT_VERIFIED'),
    err(403, 'ACTING_AS_FORBIDDEN'),
    err(404, 'NOT_FOUND'),
    err(503, 'PAYMENTS_UNAVAILABLE'),
  ],
});

/** FR-12. Raw body with the `Stripe-Signature` header; idempotent by event id and session id. */
export const stripeWebhook = defineContract({
  method: 'POST',
  path: '/api/webhooks/stripe',
  auth: 'public',
  status: 200,
  rawBody: true,
  response: z.object({ received: z.literal(true) }),
  errors: [err(400, 'INVALID_SIGNATURE')],
});

/** FR-13. Ledger `adjustment`; can't take available below 0. */
export const grantCredits = defineContract({
  method: 'POST',
  path: '/api/staff/businesses/:id/credits',
  auth: 'staff',
  status: 201,
  params: idParams,
  body: z.object({
    credits: z
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((n) => n !== 0, 'Enter a number other than 0'),
    reason: z.string().trim().min(1).max(200),
  }),
  response: ledgerEntry,
  errors: [err(404, 'NOT_FOUND'), err(422, 'INSUFFICIENT_CREDITS')],
});

/** FR-13. All packs, active or not, in display order (one page, `nextCursor` null). */
export const listCreditPacks = defineContract({
  method: 'GET',
  path: '/api/staff/credit-packs',
  auth: 'staff',
  status: 200,
  response: page(creditPack),
});

export const createCreditPack = defineContract({
  method: 'POST',
  path: '/api/staff/credit-packs',
  auth: 'staff',
  status: 201,
  body: creditPackInput,
  response: creditPack,
});

export const updateCreditPack = defineContract({
  method: 'PUT',
  path: '/api/staff/credit-packs/:id',
  auth: 'staff',
  status: 200,
  params: idParams,
  body: creditPackInput,
  response: creditPack,
  errors: [err(404, 'NOT_FOUND')],
});

export const billingContracts = {
  getCredits,
  listLedger,
  createCheckout,
  stripeWebhook,
  grantCredits,
  listCreditPacks,
  createCreditPack,
  updateCreditPack,
} as const;
