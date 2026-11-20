/**
 * Audit log actions for state-changing requests made while Acting as (FR-7): dot-named, derived
 * from the route pattern, e.g. `PUT /api/plans/:id` → `plan.updated` on target `plan` <id>.
 */

export interface AuditTarget {
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
}

/** Routes whose writes are recorded elsewhere (back office, sign-in) or are not customer writes. */
const SKIPPED_PREFIXES = ['/staff/', '/auth/', '/webhooks/', '/public/'];

/** `POST /<resource>/:id/<verb>` actions. */
const VERB_ACTIONS: Readonly<Record<string, string>> = {
  cancel: 'cancelled',
  resume: 'resumed',
  feedback: 'feedback_given',
};

/** `POST /<parent>/:id/<collection>` that mean something more specific than "created". */
const COLLECTION_ACTIONS: Readonly<Record<string, string>> = { runs: 'started' };

const METHOD_ACTIONS: Readonly<Record<string, string>> = {
  POST: 'created',
  PUT: 'updated',
  PATCH: 'updated',
  DELETE: 'deleted',
};

export function singular(noun: string): string {
  if (noun.endsWith('ies')) return `${noun.slice(0, -3)}y`;
  if (noun.endsWith('ss')) return noun;
  if (noun.endsWith('s')) return noun.slice(0, -1);
  return noun;
}

function snake(segment: string): string {
  return segment.replace(/[-\s]+/g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

const isParam = (segment: string) => segment.startsWith(':');

/**
 * The audit action for a request, or null when it isn't audited this way.
 * `route` is the route pattern (`/api/plans/:id`); `params` the matched path parameters.
 */
export function auditTargetFor(
  method: string,
  route: string,
  params: Readonly<Record<string, string>>,
): AuditTarget | null {
  const verb = METHOD_ACTIONS[method.toUpperCase()];
  if (!verb) return null;
  const path = route.replace(/^\/api(?=\/)/, '');
  if (SKIPPED_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;
  const segments = path.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (last === undefined) return null;

  const lastParamIndex = segments.findLastIndex(isParam);
  const paramName = lastParamIndex >= 0 ? (segments[lastParamIndex] ?? '').slice(1) : null;
  const targetId = paramName ? (params[paramName] ?? null) : null;

  if (isParam(last)) {
    const resource = snake(singular(segments.at(-2) ?? 'resource'));
    return { action: `${resource}.${verb}`, targetType: resource, targetId };
  }

  const before = segments.at(-2);
  if (before !== undefined && isParam(before)) {
    const parent = snake(singular(segments.at(-3) ?? 'resource'));
    const named = VERB_ACTIONS[last];
    if (named) return { action: `${parent}.${named}`, targetType: parent, targetId };
    const child = snake(singular(last));
    const childVerb = verb === 'created' ? (COLLECTION_ACTIONS[last] ?? verb) : verb;
    return { action: `${child}.${childVerb}`, targetType: parent, targetId };
  }

  const resource = snake(singular(last));
  return { action: `${resource}.${verb}`, targetType: resource, targetId };
}

const SECRET_KEY = /pass(word)?|secret|token|api_?key|authorization|cookie/i;

/** Audit details never hold secret values: any key that names a secret is dropped. */
export function scrubAuditDetails(details: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? scrubAuditDetails(value as Record<string, unknown>)
        : value;
  }
  return out;
}
