import { z } from 'zod';
import type { ErrorCode } from './errors.js';

// ---------------------------------------------------------------------------------------------
// Contract definition
// ---------------------------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Who may call an endpoint (PRD section 7):
 * - `public`: anyone.
 * - `session`: a signed-in Member (Acting as resolves to the target Business's Owner).
 * - `halfSession`: a Staff Member after the password step, before the two-factor code (FR-5).
 * - `staff`: Staff with `two_factor_passed`, not affected by Acting as.
 */
export type Auth = 'public' | 'session' | 'halfSession' | 'staff';

export type ContentType =
  'application/json' | 'text/csv' | 'text/html' | 'application/xml' | 'text/plain';

export interface ContractError {
  readonly status: number;
  readonly code: ErrorCode;
}

export interface ContractInput {
  readonly method: HttpMethod;
  /** The full path as the browser calls it, Fastify style (`/api/plans/:id`). */
  readonly path: string;
  readonly auth: Auth;
  /** The success status code. */
  readonly status: number;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  /** The success body. `noContent` for 202/204 responses without a body. */
  readonly response: z.ZodType;
  /** The documented error codes. Implied codes (400, 401, 403, 429) are added by `defineContract`. */
  readonly errors?: readonly ContractError[];
  /** Response content type; JSON when omitted. */
  readonly contentType?: ContentType;
  /** The request body is read raw, not parsed (Stripe webhook signature check). */
  readonly rawBody?: boolean;
  /** The request body is `application/x-www-form-urlencoded` (server-rendered site forms). */
  readonly formBody?: boolean;
}

export type Contract<C extends ContractInput = ContractInput> = Omit<C, 'errors'> & {
  readonly errors: readonly ContractError[];
};

export const err = (status: number, code: ErrorCode): ContractError => ({ status, code });

function impliedErrors(c: ContractInput): ContractError[] {
  const implied: ContractError[] = [];
  if (c.body || c.params || c.query || c.rawBody) implied.push(err(400, 'VALIDATION_ERROR'));
  if (c.auth !== 'public') implied.push(err(401, 'UNAUTHENTICATED'));
  if (c.auth === 'staff') {
    implied.push(err(403, 'FORBIDDEN'), err(403, 'TWO_FACTOR_REQUIRED'));
  }
  implied.push(err(429, 'RATE_LIMITED'));
  return implied;
}

/**
 * Declares an endpoint once, so routes (Fastify + fastify-type-provider-zod), web hooks and MSW
 * handlers share the same schemas. Adds the implied error codes to `errors`.
 */
export function defineContract<const C extends ContractInput>(c: C): Contract<C> {
  const all = [...impliedErrors(c), ...(c.errors ?? [])];
  const errors = all.filter(
    (e, i) => all.findIndex((o) => o.status === e.status && o.code === e.code) === i,
  );
  return { ...c, errors };
}

/** The path relative to the `/api` prefix, as modules register it (`/plans/:id`). */
export function routePath(c: Pick<ContractInput, 'path'>): string {
  return c.path.startsWith('/api/') ? c.path.slice(4) : c.path;
}

/** Fills `:name` segments: `pathFor(getPlan, { id })` → `/api/plans/<id>`. */
export function pathFor(
  c: Pick<ContractInput, 'path'>,
  params: Record<string, string | number> = {},
): string {
  return c.path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${c.path}`);
    return encodeURIComponent(String(value));
  });
}

// ---------------------------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------------------------

/** Ids are UUID v7 strings; `guid` accepts any 8-4-4-4-12 hex id so test fixtures stay simple. */
export const id = z.guid();
/** ISO 8601 UTC with `Z`, e.g. `2026-11-19T10:00:00.000Z`. */
export const isoDateTime = z.iso.datetime();
/** ISO date `YYYY-MM-DD`. */
export const isoDate = z.iso.date();
/** Credits are whole numbers (ADR 0009). */
export const credits = z.int();

/** Email input: trimmed, stored lowercased, at most 254 characters. */
export const emailInput = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const email = z.email();

export const money = z.object({
  cents: z.int().nonnegative(),
  currency: z.literal('usd'),
});
export type Money = z.infer<typeof money>;

/** Where a fact came from and when (NFR-5: every contact and Evidence item keeps one). */
export const source = z.object({
  name: z.string().min(1),
  url: z.string().nullable(),
  retrievedAt: isoDateTime,
});
export type Source = z.infer<typeof source>;

export const idParams = z.object({ id });
export type IdParams = z.infer<typeof idParams>;

/** `?cursor=&limit=` (limit default 25 unless stated, max 100). */
export function listQuery(defaultLimit = 25) {
  return z.object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(defaultLimit),
  });
}

/** A page of a list: `{ items, nextCursor }`, `nextCursor` null on the last page. */
export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

/** Success without a body (202/204). Routes reply with no payload. */
export const noContent = z.null();

/** A percentage 0..100, or null when there is no data. */
export const pct = z.number().min(0).max(100);
