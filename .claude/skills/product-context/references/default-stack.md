# Default stack (proposal for docs/architecture/stack.md)

This is what `/product-context` proposes for a new product. After it's confirmed, it is copied into `docs/architecture/stack.md`, and from then on **that file** is the source of truth, not this one. Fill the `<…>` placeholders with the host's real values.

## Hosting facts
| Fact | Value |
|---|---|
| Host | cPanel (CloudLinux "Setup Node.js App" on Phusion Passenger) |
| Node versions offered | `<e.g. 18, 20, 22>`; use the newest LTS offered |
| Database server | `<MySQL 8.0 / 8.4 / MariaDB 10.x>` |
| Domains | web + API at `https://<app.example.com>`, API under `/api` |
| Staging | `https://staging.<example.com>`, a second Node app and a second database |

## Stack
| Concern | Choice | Why |
|---|---|---|
| Repo | npm workspaces: `apps/api`, `apps/web`, `packages/contracts`, `e2e/` | one install, shared contracts |
| Language | TypeScript `strict`, ESM | |
| Architecture | Modular monolith, bounded contexts, hexagonal layers | ADR 0001 |
| API | Fastify, `fastify-type-provider-zod`, `@fastify/swagger` (non-prod `/api/docs`), pino → stdout | fast, typed, self-documenting |
| Validation / contracts | Zod schemas in `packages/contracts`, shared by API and web | no drift |
| DB | the host's DB server via `mysql2` + Kysely, Kysely migrations | pure JS, no native engines; ADR 0002 |
| Auth | DB-backed sessions, httpOnly `SameSite=Lax` cookie, `bcryptjs` (pure JS) | stateless processes on Passenger; ADR 0004 |
| Origin layout | one origin: SPA at `/`, API at `/api`; Vite proxy in dev and e2e | no CORS, cookies just work; ADR 0003 |
| Frontend | React + Vite, React Router, TanStack Query, React Hook Form + Zod | |
| UI kit | Tailwind CSS + shadcn/ui-style components in `apps/web/src/shared/ui` | fast, consistent, accessible |
| Background jobs | cPanel cron + outbox table | no long-running workers on shared hosting |
| Email | SMTP via `nodemailer` (the host's mail or a provider such as Postmark), behind an `EmailSender` port | |
| Product analytics | `AnalyticsTracker` port; default adapter writes to an `analytics_events` table, swappable for PostHog or Plausible | measure the PRD goals from day one |
| Error tracking | Sentry (`@sentry/node`, `@sentry/react`), enabled when `SENTRY_DSN` is set | |
| Feature flags | env-based `FEATURE_<NAME>` toggles read by a `Features` port | enough until there's a real need |
| Unit/integration tests | Vitest 4 (`test.projects`), Testing Library, MSW, Fastify `inject`, all run in Docker | ADR 0005 |
| Acceptance tests | Playwright in Docker (`mcr.microsoft.com/playwright:v<x>-noble`, matching `@playwright/test`) | |
| Docker images | `node:<host-node-major>-slim`, `<mysql:8.x or mariadb:10.x matching host>` | tests match production |
| Lint/format/types | ESLint flat config (typescript-eslint, eslint-plugin-boundaries), Prettier, `tsc -b` with project references | |
| Build/deploy | esbuild bundles the API into `dist/` (contracts inlined), Vite builds the web app; `/ship-requirement` deploys | ADR 0006 |
| CI | GitHub Actions: lint, typecheck, `test:docker`, `test:e2e`, build, `npm audit --omit=dev` | |

## Commands (repo root)
All through Docker (no Node on the host): `./dev install` · `./dev up` · `./dev seed` · `./dev test [paths]` · `./dev e2e [specs]` · `./dev lint` · `./dev typecheck` · `./dev build` · `./dev check` (all of them) · `./dev add <pkg> -w <workspace>`
