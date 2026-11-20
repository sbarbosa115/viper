import type { FastifyReply } from 'fastify';

const GOOGLE_TAG = 'https://www.googletagmanager.com';
const GA_COLLECT = ['https://*.google-analytics.com', 'https://*.analytics.google.com'];

/**
 * The site's Content-Security-Policy (ADR 0016): Google Fonts, YouTube thumbnails and the
 * youtube-nocookie player, and Google Analytics only when a measurement ID is set (FR-9).
 * `upgrade-insecure-requests` only over HTTPS, or local http hosts would break.
 */
export function siteCsp(opts: { analytics: boolean; secure: boolean }): string {
  const ga = opts.analytics;
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-ancestors', ["'self'"]],
    ['form-action', ["'self'"]],
    ['script-src', ["'self'", ...(ga ? [GOOGLE_TAG] : [])]],
    ['script-src-attr', ["'none'"]],
    ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
    ['font-src', ["'self'", 'https://fonts.gstatic.com']],
    [
      'img-src',
      ["'self'", 'data:', 'https://i.ytimg.com', ...(ga ? [GOOGLE_TAG, ...GA_COLLECT] : [])],
    ],
    ['frame-src', ['https://www.youtube-nocookie.com']],
    ['connect-src', ["'self'", ...(ga ? [GOOGLE_TAG, ...GA_COLLECT] : [])]],
  ];
  const policy = directives.map(([name, values]) => `${name} ${values.join(' ')}`);
  if (opts.secure) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

/**
 * Overrides helmet's API defaults for HTML pages. The Referrer-Policy must not be `no-referrer`:
 * browsers then send `Origin: null` with form posts, and the forms' Origin check would fail.
 */
export function setPageSecurityHeaders(
  reply: FastifyReply,
  opts: { analytics: boolean; secure: boolean },
): void {
  reply.header('content-security-policy', siteCsp(opts));
  reply.header('referrer-policy', 'strict-origin-when-cross-origin');
  reply.header('x-content-type-options', 'nosniff');
}

export type PageCaching = 'public' | 'private' | 'none';

/**
 * `public`: the anonymous page; browsers revalidate, a CDN may keep it 5 minutes.
 * `private`: the signed-in variant. `none`: form results.
 */
export function setPageCaching(reply: FastifyReply, caching: PageCaching): void {
  reply.header('vary', 'Cookie');
  if (caching === 'public') reply.header('cache-control', 'public, max-age=0, s-maxage=300');
  else if (caching === 'private') reply.header('cache-control', 'private, no-cache');
  else reply.header('cache-control', 'no-store');
}
