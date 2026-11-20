# 0004. Database sessions in an httpOnly cookie

- Status: Accepted
- Date: 2026-11-18

## Context
Businesses have several Members and Staff need a separate permission. Processes are stateless and can restart at any time.

## Decision
Sessions stored in MySQL, referenced by an httpOnly, Secure, `SameSite=Lax` cookie. CSRF protection by Origin check on state-changing requests. Passwords hashed with `bcryptjs` (cost 12). Login attempts rate-limited by a `login_attempts` table. Authorization checked in use cases against an `Actor` (member of Business X with role R, or Staff).

## Alternatives considered
- JWTs: hard to revoke, easy to misuse.
- Third-party auth (Auth0, Clerk): cost and lock-in; can be added later behind the same Actor.

## Consequences
Logout and revocation are immediate. Every query is scoped to the Actor's Business.
