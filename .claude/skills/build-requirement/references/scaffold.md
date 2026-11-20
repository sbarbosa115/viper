# Scaffold (first build only, package WP-0a)

Write files directly. Interactive generators such as `npm create vite` hang an agent. **There is no Node on the host:** every Node command goes through `./dev` (see `docker.md`). Check current stable versions with `./dev npm view <pkg> version`, and pin the Node and DB versions from `docs/architecture/stack.md`. **Merge** with existing files (`.gitignore`, `CLAUDE.md`, `.idea` settings) rather than overwriting them.

## Root
- `package.json`: `"private": true`, `"type": "module"`, `"workspaces": ["apps/*", "packages/*"]`, `engines.node` set to the host's major version. `@playwright/test` and the lint and format tools are root devDependencies.
- npm scripts (they run **inside** containers, called by `./dev`): `lint` (`eslint`), `format`, `typecheck` (`tsc -b`), `build` (`npm run build -w apps/api && npm run build -w apps/web`), `coverage`. Docker orchestration is not an npm script: it lives in `./dev` and `scripts/*.sh`.
- TypeScript: `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`). The root `tsconfig.json` has `references` to every workspace, so `tsc -b` checks them all. The api and contracts packages use `module: NodeNext`; web uses `moduleResolution: Bundler`.
- `eslint.config.js` (flat config): typescript-eslint `recommendedTypeChecked`, `eslint-plugin-boundaries` enforcing the layer and module rules in `architecture.md`, react-hooks for web, and Prettier compatibility.
- `vitest.config.ts` as in `testing.md`.
- The Docker files from `docker.md`: `./dev` (executable), `Dockerfile`, `.dockerignore`, `docker-compose.tools.yml`, `docker-compose.test.yml`, `docker-compose.dev.yml`, `docker-compose.e2e.yml`, `scripts/test-docker.sh`, `scripts/test-e2e.sh`.
- `.gitignore` additions: `node_modules`, `dist`, `coverage`, `.env*` (except `.env.example`), `playwright-report`, `test-results`, `.build/`, `.npm-cache/`.
- `.nvmrc`, `.editorconfig`, `.env.example`.
- **CI** (`.github/workflows/ci.yml`): the same commands as local, all through Docker: `./dev install`, `./dev lint`, `./dev typecheck`, `./dev test`, `./dev e2e`, `./dev build`, `./dev npm audit --omit=dev --audit-level=high`. No `setup-node` step. Upload the Playwright report when it fails.

## packages/contracts
Zod schemas and inferred types per context, plus `errorResponse` (the shared error shape). Export them as TS source through `exports`. Both apps compile them in: Vite for web, esbuild for the api bundle.

## apps/api
- Dependencies: `fastify`, `@fastify/helmet`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/swagger-ui`, `fastify-type-provider-zod`, `zod`, `kysely`, `mysql2`, `pino`, `bcryptjs`, `nodemailer`, `@sentry/node`. Dev dependencies: `typescript`, `tsx`, `esbuild`, `vitest`, `@types/node`.
- `src/config/env.ts`: a Zod schema for the environment, parsed **only in `main.ts`**. It fails fast with a clear message.
- `src/app.ts`: `buildApp(config, deps)` registers helmet, cookie, the auth plugin, the error handler, swagger (not in production), `GET /api/health` (checks the DB with `SELECT 1`) and the modules, all under the `/api` prefix.
- `src/main.ts` is the composition root. `test/build-test-app.ts` and `test/global-setup.ts` are as in `testing.md`.
- `src/shared/`: errors, `Clock`, `IdGenerator`, `Actor`, the `AnalyticsTracker` port with a DB adapter writing to `analytics_events`, the `EmailSender` port with SMTP and in-memory adapters, the `Features` port (env flags), and `infrastructure/db` (the Kysely `MysqlDialect` pool, the `schema.ts` interface composed from each module's `tables.ts`, and a `UnitOfWork` built on `db.transaction()`).
- **Migrations:** `migrations/*.ts`, run by `src/scripts/migrate.ts` with Kysely's `Migrator` + `FileMigrationProvider` and **`allowUnorderedMigrations: true`**. Scripts: `migrate`, `migrate:down`. The first migrations create `analytics_events`, `sessions` and `login_attempts`.
- **DB conventions:** `utf8mb4`, InnoDB, `DATETIME(3)` stored as UTC (`timezone: 'Z'` in mysql2), `CHAR(36)` UUIDs, an index on every foreign key.
- **Build** (`build.mjs`, using esbuild): entry points `src/main.ts`, `src/scripts/*.ts` and `migrations/*.ts` → `dist/`, with `platform: node`, `format: esm`, `bundle: true`, and the banner `import { createRequire } from 'module'; const require = createRequire(import.meta.url);` so bundled CommonJS dependencies work. Everything is bundled, contracts included. Only packages that can't be bundled go in `external`, and those are listed with exact versions in a generated `dist/package.json`. Copy any file the api reads at runtime into `dist/` too. Use an aliased banner import (`import { createRequire as __cjsRequire } from 'module'`) so it can't clash with a bundled dependency's own `createRequire` import.
- Wave 0 check: build the production `api` image from the Dockerfile, start it against the test database, and confirm `/api/health` responds. That proves the artifact runs without the monorepo.
- **Sentry:** initialise in `main.ts` only when `SENTRY_DSN` is set. pino logs to stdout, which App Platform collects (`doctl apps logs`).

## apps/web
- Files written by hand: `index.html`, `vite.config.ts` (React plugin; `server.proxy` and `preview.proxy` both map `/api` → `process.env.API_PROXY_TARGET ?? 'http://localhost:3000'`), `src/main.tsx`, `src/app/router.tsx`, and `src/app/providers.tsx` (QueryClient, Router, ErrorBoundary, Sentry if a DSN is set).
- Dependencies: `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`, `tailwindcss`, `@tailwindcss/vite`, `@sentry/react`. Dev dependencies: `@vitejs/plugin-react`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `msw`.
- `src/shared/ui/`: the base kit (Button, Input, Field with label and error, Select, Dialog, Table, EmptyState, ErrorState, Spinner, Toast). Accessible, with Tailwind design tokens defined in CSS. Feature agents use it and don't add to it mid-wave.
- `src/shared/api/client.ts`: `fetch` against a relative `/api`, `credentials: 'same-origin'`, JSON, and maps the error shape to `ApiError`.
- `src/shared/analytics.ts`: `track(event, props)` → `POST /api/analytics/events` (or the provider SDK from stack.md).
- `vite.config.ts` uses `base: '/app/'`. No server config is needed: App Platform serves the SPA as a static site at `/app` with `index.html` as the catch-all document (`.do/app.yaml`).

## Verify
On a machine with only Docker: `./dev install`, then `./dev lint`, `./dev typecheck`, `./dev test`, `./dev e2e` (one smoke spec: the app loads and health is OK), `./dev build`, `./dev up` (the app answers on http://localhost:5173) and the production image boot check. All must pass, with one example test per layer so the pattern is visible to the agents that follow.
