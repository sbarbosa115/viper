import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionPolicy } from '../domain/session.js';

/** ADR 0004: the cookie holds the raw token; the database holds only its sha-256. */
export const SESSION_COOKIE = 'sid';

export interface CookieOptions {
  /** `Secure` in production (NFR-4). */
  secure: boolean;
}

/**
 * Reads `sid` from the Cookie header. It does not rely on @fastify/cookie, because the Actor is
 * resolved in an onRequest hook that may run before the cookie plugin's own hook.
 */
export function readSessionToken(req: FastifyRequest): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** httpOnly, SameSite=Lax, Path=/, 30 days; re-set on use so the browser expiry slides too. */
export function setSessionCookie(reply: FastifyReply, token: string, opts: CookieOptions): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(sessionPolicy.ttlMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, opts: CookieOptions): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'lax',
    path: '/',
  });
}
