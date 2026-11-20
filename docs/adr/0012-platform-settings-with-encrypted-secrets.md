# 0012. Provider keys and service credentials in encrypted Platform settings

- Status: Accepted
- Date: 2026-11-19
- Amends: stack.md "Secrets" (previously: all secrets in App Platform env vars)

## Context
Staff must add AI models, data providers, SMTP and Stripe credentials, and change them, without a redeploy. The founder runs operations alone from the back office.

## Decision
Provider, model, SMTP, Stripe and analytics settings live in a `settings` table owned by the `platform` context. Secret fields are encrypted with AES-256-GCM using `SETTINGS_ENCRYPTION_KEY` (env), are write-only through the API (only `last4` is returned), are never logged, and every change is written to the Audit log. Settings are cached for at most 60 s in api and worker. Only infrastructure secrets stay in env vars: database, Valkey, session secret, the encryption key, Sentry DSN.

## Alternatives considered
- Env vars only: every key change needs a redeploy and DigitalOcean console access.
- A secrets manager (Vault, Doppler): another system to run or pay for at this size.

## Consequences
Losing `SETTINGS_ENCRYPTION_KEY` makes stored secrets unreadable (they must be re-entered), so it is backed up outside DigitalOcean. A database dump alone doesn't expose keys. Rotating the encryption key needs a small re-encrypt script.
