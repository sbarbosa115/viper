import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ForbiddenError } from '../../../shared/domain/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Stripe calls this server to server and proves itself with a signature instead. */
const EXEMPT_PATHS = new Set(['/api/webhooks/stripe']);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF defence (ADR 0004, NFR-4): every state-changing `/api` request must come from the app's
 * own origin (`Origin`, or `Referer` when a browser omits it). `/site/*` forms are checked by the
 * site itself, and the Stripe webhook is exempt.
 */
export function originCheck(appUrl: string) {
  const allowed = new URL(appUrl).origin;
  return (req: FastifyRequest): Promise<void> => {
    if (SAFE_METHODS.has(req.method)) return Promise.resolve();
    const path = req.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || EXEMPT_PATHS.has(path)) return Promise.resolve();
    const origin = originOf(req.headers.origin) ?? originOf(req.headers.referer);
    if (origin !== allowed) {
      return Promise.reject(new ForbiddenError('This request must come from the app'));
    }
    return Promise.resolve();
  };
}

export function registerOriginCheck(app: FastifyInstance, opts: { appUrl: string }): void {
  app.addHook('onRequest', originCheck(opts.appUrl));
}
