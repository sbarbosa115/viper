# Stack and hosting (source of truth)

_Last updated: 2026-11-20._ Every skill reads this file; none hardcodes the stack. Changes need an ADR.

## Hosting facts
| Fact | Value |
|---|---|
| Host | DigitalOcean App Platform (ADR 0006) |
| Components | `web` (static site, the SPA at `/app`), `api` (service: Fastify JSON API at `/api` and the server-rendered public site at `/`, ADR 0016), `worker` (worker, BullMQ consumers running research and other background jobs) |
| Node | 24 LTS, **only inside containers** (`node:24-slim`); the developer machine needs only Docker, bash and git (ADR 0015). Pin the version in `engines` and the images. Move to the next LTS with an ADR |
| Database | DigitalOcean Managed MySQL 8 (pin the cluster's exact version in `docker-compose` as `mysql:8.0` or `mysql:8.4` to match) (ADR 0002) |
| Queue / cache | DigitalOcean Managed Caching (Valkey, Redis-compatible) for BullMQ (ADR 0008) |
| File storage | DigitalOcean Spaces (S3-compatible), not used in the first version (CSV is streamed) |
| Domains | one domain: `https://<domain>` with the site at `/`, the SPA at `/app` and the API at `/api` (ADR 0016); domain `leads.llyner.com` (primary; DNS by the founder, 2026-11-20) |
| Region | NYC (`nyc`): customers are US-only. App, database and Valkey all in the same region |
| Deploy gates | One environment to start (ADR 0018). Deploys are manual (`.github/workflows/deploy.yml`, `workflow_dispatch`) and wait for the founder's approval (GitHub environment `production` with a required reviewer). No auto-deploy |
| Staging | none for now (ADR 0018); add a second app from `.do/app.yaml` when needed. Setup and costs: `docs/ops/digitalocean-setup.md` |
| Secrets | Infrastructure secrets (`DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `SENTRY_DSN`) in App Platform encrypted env vars. Provider, model, SMTP and Stripe keys in Platform settings, encrypted with AES-256-GCM (ADR 0012). Never in the repo |

## Stack
| Concern | Choice | Why |
|---|---|---|
| Repo | npm workspaces: `apps/api`, `apps/web`, `packages/contracts`, `e2e/` | one install, shared contracts |
| Language | TypeScript `strict`, ESM | |
| Architecture | Modular monolith, bounded contexts (context-map.md), hexagonal layers | ADR 0001 |
| API | Fastify, `fastify-type-provider-zod`, `@fastify/swagger` (non-prod `/api/docs`), pino → stdout | fast, typed, self-documenting |
| Worker | Same codebase as the API, separate entry point (`apps/api/src/worker.ts`) running BullMQ workers | one model, shared modules; ADR 0008 |
| Validation / contracts | Zod schemas in `packages/contracts`, shared by API and web | no drift |
| DB | MySQL 8 via `mysql2` + Kysely, Kysely migrations (`allowUnorderedMigrations`) | type-safe, pure JS; ADR 0002 |
| Auth | DB-backed sessions, httpOnly `SameSite=Lax` cookie, `bcryptjs`; TOTP two-factor (`otplib`) for Staff; Acting as on the session | ADR 0004, ADR 0014 |
| Origin layout | one origin: public site at `/` (server-rendered by the api), SPA at `/app`, API at `/api` (App Platform routes); Vite proxy in dev and e2e | no CORS, cookies just work; ADR 0003, ADR 0016 |
| AI | Anthropic API (Claude) via `@anthropic-ai/sdk`, behind ports: the strongest model for planning and scoring, a fast model for extraction | ADR 0008 |
| Data providers | Apify (scrapers), Google Places API, Overpass (OpenStreetMap), Overture/Foursquare open places, Firecrawl (website reader), Apollo/Hunter (enrichment), ZeroBounce (email), Twilio Lookup (phone), each a Tool adapter in `modules/tools` | ADR 0007 |
| Payments | Stripe Checkout for credit packs (Stripe Tax on), Stripe webhooks for fulfilment | |
| Frontend | React + Vite, React Router, TanStack Query, React Hook Form + Zod | |
| UI kit | Tailwind CSS v4 + shadcn/ui-style components in `apps/web/src/shared/ui`, themed by DESIGN.md tokens | ADR 0010 |
| Background jobs | BullMQ queues on Valkey (research runs, enrichment, emails, scheduled jobs), fed by an outbox table for events | ADR 0008 |
| Email | SMTP via `nodemailer` behind an `EmailSender` port, credentials in Platform settings; Mailpit in dev and e2e | ADR 0013 |
| Product analytics | `AnalyticsTracker` port writing to an `analytics_events` table; Google Analytics page views when a measurement ID is set in Platform settings | measure the PRD goals from day one |
| Error tracking | Sentry (`@sentry/node`, `@sentry/react`), enabled when `SENTRY_DSN` is set | |
| Feature flags | env-based `FEATURE_<NAME>` toggles read by a `Features` port | |
| Local development | Everything in Docker Compose through `./dev`: install, lint, typecheck, tests, e2e, dev servers (api, worker, web), MySQL, Valkey, Mailpit | ADR 0015 |
| Unit/integration tests | Vitest 4 (`test.projects`), Testing Library, MSW, Fastify `inject`, all run in Docker; provider adapters tested against recorded fixtures, never live APIs | ADR 0005 |
| Acceptance tests | Playwright in Docker (`mcr.microsoft.com/playwright:v<x>-noble`, matching `@playwright/test`); the agent runs against fake Tools | |
| Docker images | `node:24-slim`, `mysql:8.x` matching the cluster, `valkey/valkey:8`, `axllent/mailpit` (dev/e2e) | tests match production |
| Lint/format/types | ESLint flat config (typescript-eslint, eslint-plugin-boundaries), Prettier, `tsc -b` with project references | |
| Build/deploy | Docker image per component built by App Platform from the repo (root `Dockerfile`: default/`TARGET=api` for api and worker, `TARGET=web` for the static site; spec in `.do/app.yaml`); migrations run as a pre-deploy job | ADR 0006 |
| CI | GitHub Actions running the same `./dev` commands (no `setup-node`): lint, typecheck, test, build, `npm audit --omit=dev`. E2E (`./dev e2e`) runs locally, before merging | local = CI |

## Commands (repo root)
All through Docker (no Node on the host): `./dev install` · `./dev up` · `./dev seed` · `./dev test [paths]` · `./dev e2e [specs]` · `./dev lint` · `./dev typecheck` · `./dev build` · `./dev check` (all of them) · `./dev add <pkg> -w <workspace>`

