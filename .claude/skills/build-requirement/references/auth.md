# Authentication and authorization

Nearly every product needs this, so it's standardised here. The first PRD's Wave 0 or Wave 1 must include the `identity` module.

## Model
- **Sessions in the database, not JWTs.** Kubernetes may run several containers and replace them at any time, so nothing can live in memory. With DB sessions, logout and revocation are trivial.
- Table `sessions`: `id`, `user_id`, `token_hash` (SHA-256 of a random 32-byte token), `expires_at`, `last_seen_at`, `user_agent`, `ip`. Expiry slides: 30 days, extended when the session is used, written at most once an hour.
- Cookie `sid`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production. It's only the raw token; only its hash is stored.
- **CSRF:** one origin plus `SameSite=Lax` blocks cross-site form posts. In addition, every non-GET request must carry `Origin` (or `Referer`) equal to `WEB_ORIGIN`, otherwise 403.
- **Passwords:** `bcryptjs` (pure JS, cost 12), because native hashing libraries often fail on CloudLinux hosts. Minimum length 10, and reject the most common passwords.

## identity module
- Use cases: `SignUp`, `LogIn`, `LogOut`, `GetCurrentActor`, `RequestPasswordReset`, `ResetPassword` and, if the PRD needs them, `VerifyEmail` and `InviteUser`.
- Reset and verification tokens are random, stored hashed, single-use and short-lived (1 hour), and emailed through the `EmailSender` port.
- `LogIn` returns the same error for an unknown email and a wrong password. A login attempt costs the same time either way (hash a dummy password when the user doesn't exist).
- **Brute-force protection:** a `login_attempts` table (per email and per IP, in a 15-minute window). `@fastify/rate-limit` counts per process, so with several containers it's only a soft extra layer.

## Actor and authorization
```ts
// shared/domain/actor.ts
export interface Actor { readonly userId: UserId; readonly roles: readonly Role[]; readonly orgId?: OrgId }
```
- The auth plugin resolves the cookie to an `Actor` (through identity's public `getActor`) and sets `req.actor`. `app.authenticate` returns 401 when there isn't one.
- **Authorization lives in use cases**, as small policy functions per module (`canCancelOrder(actor, order)`), so it applies however the use case is called. Routes only require authentication.
- Multi-tenant data: every query is scoped by `orgId` from the actor, and the repository tests assert that one org can't read another's data.

## Testing
- Application tests pass an `Actor` built by factories (`customer()`, `admin()`).
- HTTP tests use `buildTestApp({ actor })` (stub auth). One identity HTTP test suite covers the real cookie flow: sign up, log in, `Set-Cookie`, an authenticated call, log out, then 401.
- Playwright `loginAs(role)` logs in through the UI once per worker and reuses the `storageState`.
