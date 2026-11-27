import { isIP } from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The client's address from a trusted source; read it through `clientIp(req)`. Undefined only
     * on an app built without registerClientIp (a bare test app).
     */
    readonly clientIp?: string;
  }
}

export interface ClientIpOptions {
  /**
   * A header the edge proxy sets and the client can't (production: Traefik's `x-real-ip`). When
   * absent or not an IP, the address comes from the socket and the trusted proxy hops.
   */
  header?: string | undefined;
}

/** One proxy hop: Traefik in production, or Vite's dev and preview proxy. */
export const DEFAULT_TRUST_PROXY_HOPS = 1;

/**
 * Fastify's `trustProxy` for a hop count: the socket peer and the `hops - 1` entries the proxies
 * appended next to it are trusted, so `req.ip` is the address the outermost trusted proxy saw.
 * (Fastify ignores a plain number, and `true` would trust the client-written left-most entry.)
 */
export function trustHops(hops: number): (address: string, hop: number) => boolean {
  return (_address, hop) => hop < hops;
}

function fromHeader(req: FastifyRequest, header: string | undefined): string | null {
  if (!header) return null;
  const raw = req.headers[header];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.split(',')[0]?.trim();
  return value && isIP(value) ? value : null;
}

/**
 * Adds `req.clientIp`, the address every IP limit uses (sign-ups, log-ins, the site forms, the
 * global rate limit). Build Fastify with `trustProxy: trustHops(n)`, never `true`: with `true`,
 * `req.ip` is the left-most `X-Forwarded-For` entry, which the client writes.
 */
export function registerClientIp(app: FastifyInstance, options: ClientIpOptions = {}): void {
  const header = options.header?.toLowerCase();
  app.decorateRequest('clientIp', {
    getter(this: FastifyRequest) {
      return fromHeader(this, header) ?? this.ip;
    },
  });
}

/** The client's address for rate limits and `login_attempts`. */
export function clientIp(req: FastifyRequest): string {
  return req.clientIp ?? req.ip;
}
