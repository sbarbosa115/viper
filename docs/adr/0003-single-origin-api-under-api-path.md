# 0003. One origin: SPA at /, API under /api

- Status: Accepted
- Date: 2026-11-18

## Context
Session cookies and CSRF protection are simplest when the web app and API share an origin.

## Decision
`app.<domain>` serves the SPA at `/` (App Platform static site) and routes `/api/*` to the `api` service with the path prefix preserved. In development and e2e, Vite proxies `/api`. The marketing site lives on the apex domain.

## Alternatives considered
- Separate API subdomain with CORS: more configuration, third-party cookie issues.

## Consequences
All API routes are registered under `/api`. No CORS configuration.
