# Docker: the only local runtime (develop, test, e2e)

**No Node.js on the host.** The machine needs only Docker, bash and git. Every Node command (install, lint, typecheck, Vitest, Playwright, dev servers, builds, one-off `npm`/`npx`) runs in a container, through one entry point: the `./dev` script at the repo root. CI runs the same `./dev` commands, so local and CI results match. Production (DigitalOcean App Platform) builds its own images from the Dockerfiles.

Pin versions to `docs/architecture/stack.md`: the Node image (`node:24-slim`), MySQL (matching the managed cluster), Valkey, Mailpit and Playwright (`mcr.microsoft.com/playwright:v<x>-noble`, equal to `@playwright/test` in the lockfile).

## How dependencies work
- `node_modules` lives **in the bind-mounted repo** (written by `./dev install` inside a container), so editors see the types and no image rebuild is needed when dependencies change.
- Containers run as the WSL user (`user: "${UID:-1000}:${GID:-1000}"`), so nothing in the repo becomes root-owned.
- The npm cache is a named volume (`npm-cache`), shared by every Compose project.
- **Only the orchestrator (or the main session) installs or removes packages** (`./dev install`, `./dev add …`). Agents never do: two installs at once corrupt `node_modules`.

## `./dev` (repo root, executable)
```bash
#!/usr/bin/env bash
# Every Node command runs in Docker. The host needs only Docker, bash and git.
set -euo pipefail
cd "$(dirname "$0")"
export UID GID="$(id -g)"
tools="docker compose -f docker-compose.tools.yml run --rm node"
dev="docker compose -f docker-compose.dev.yml"
cmd="${1:-help}"; shift || true
case "$cmd" in
  install)   $tools npm ci ;;                                   # after clone or lockfile change
  add)       $tools npm install "$@" ;;                         # ./dev add zod -w apps/api
  remove)    $tools npm uninstall "$@" ;;
  npm|npx|node) $tools "$cmd" "$@" ;;                           # ./dev npm view zod version
  shell)     $tools bash ;;
  lint)      $tools npm run lint -- "$@" ;;                     # ./dev lint apps/api/src/modules/orders
  format)    $tools npm run format ;;
  typecheck) $tools npm run typecheck ;;
  build)     $tools npm run build ;;
  test)      scripts/test-docker.sh "$@" ;;                     # Vitest with MySQL + Valkey; paths optional
  e2e)       scripts/test-e2e.sh "$@" ;;                        # Playwright against the full stack; specs optional
  check)     ./dev lint && ./dev typecheck && ./dev test && ./dev e2e && ./dev build ;;
  up)        $dev up -d "$@" ;;                                 # app on http://localhost:5173, mail on :8025
  down)      $dev down ;;
  logs)      $dev logs -f "$@" ;;
  migrate)   $dev exec api npm run migrate -w apps/api ;;
  seed)      $dev exec api npm run seed -w apps/api ;;
  *) echo "usage: ./dev install|add|remove|npm|npx|node|shell|lint|format|typecheck|build|test|e2e|check|up|down|logs|migrate|seed"; exit 1 ;;
esac
```
Exit codes pass through, so `./dev test` fails the shell when Vitest fails.

## Dockerfile (production images, also used by e2e)
Multi-stage: `deps` (`npm ci`), `build` (`npm run build`), then slim runtime targets `api` (also the worker and the migrate job, with different commands) and `web` (the SPA's static files). The deploy workflow builds each with `--target api` / `--target web`; the file still ends with `ARG TARGET=api` … `FROM ${TARGET} AS final` so a plain `docker build .` yields the api.

`.dockerignore`: `node_modules`, `**/node_modules`, `dist`, `coverage`, `playwright-report`, `test-results`, `.env*`, `.git`, `.build`, `.npm-cache`.

## docker-compose.tools.yml
```yaml
services:
  node:
    image: node:24-slim
    user: "${UID:-1000}:${GID:-1000}"
    working_dir: /app
    environment: { npm_config_cache: /npm-cache, HOME: /tmp }
    volumes: [".:/app", "npm-cache:/npm-cache"]
volumes:
  npm-cache: { name: viper-npm-cache }
```

## Shared Node block (test, dev, e2e Compose files)
```yaml
x-node: &node
  image: node:24-slim
  user: "${UID:-1000}:${GID:-1000}"
  working_dir: /app
  environment: &node-env { HOME: /tmp }
  volumes: [".:/app"]
```

## Backing services
```yaml
  db:
    image: mysql:8.4                      # match the managed cluster
    environment: { MYSQL_ROOT_PASSWORD: test, MYSQL_DATABASE: app_test }
    tmpfs: /var/lib/mysql                 # test/e2e only; dev uses a named volume
    healthcheck:                          # a real query: the socket ping passes too early during init
      test: ["CMD-SHELL", "mysql -h127.0.0.1 -uroot -ptest -e 'SELECT 1' app_test"]
      interval: 2s
      retries: 45
  valkey:
    image: valkey/valkey:8
    healthcheck: { test: ["CMD", "valkey-cli", "ping"], interval: 2s, retries: 30 }
  mailpit:
    image: axllent/mailpit:v1.21          # SMTP on 1025, UI and API on 8025
```

## docker-compose.test.yml
`db`, `valkey`, plus:
```yaml
  tests:
    <<: *node
    environment: { <<: *node-env, NODE_ENV: test, DATABASE_URL_TEST: "mysql://root:test@db:3306/app_test", REDIS_URL: "redis://valkey:6379" }
    depends_on: { db: { condition: service_healthy }, valkey: { condition: service_healthy } }
```
`scripts/test-docker.sh` (run by `./dev test`):
```bash
#!/usr/bin/env bash
set -euo pipefail
f=docker-compose.test.yml
export UID GID="$(id -g)"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")-test}"
trap 'docker compose -f $f down -v --remove-orphans >/dev/null 2>&1' EXIT
docker compose -f $f run --rm tests npx vitest run "$@"
```
Each parallel agent sets its own `COMPOSE_PROJECT_NAME`, so each gets its own MySQL and Valkey.

## docker-compose.dev.yml (local development and wave demos)
`db` with a named volume `dbdata:/var/lib/mysql` and database `app_dev`, `valkey`, `mailpit` with `ports: ["8025:8025"]`, plus:
```yaml
  api:
    <<: *node
    command: sh -c "npm run migrate -w apps/api && npm run dev -w apps/api"     # tsx watch
    environment: { <<: *node-env, NODE_ENV: development, DATABASE_URL: "mysql://root:test@db:3306/app_dev", REDIS_URL: "redis://valkey:6379", PORT: "3000", TOOLS_MODE: fake }
    depends_on: { db: { condition: service_healthy }, valkey: { condition: service_healthy } }
  worker:
    <<: *node
    command: npm run dev:worker -w apps/api                                      # tsx watch src/worker.ts
    environment: { <<: *node-env, NODE_ENV: development, DATABASE_URL: "mysql://root:test@db:3306/app_dev", REDIS_URL: "redis://valkey:6379", TOOLS_MODE: fake }
    depends_on: [api]
  web:
    <<: *node
    command: npm run dev -w apps/web -- --host 0.0.0.0
    environment: { <<: *node-env, API_PROXY_TARGET: "http://api:3000" }
    ports: ["5173:5173"]
    depends_on: [api]
```
Only the web and Mailpit ports are published. The browser talks to `/api` on the same origin and Vite proxies it to `api:3000`. Platform settings in dev point SMTP at `mailpit:1025`.

## docker-compose.e2e.yml
`db` (tmpfs), `valkey`, `mailpit`, `api` and `worker` like dev but with `NODE_ENV: test`, `ENABLE_TEST_HOOKS: "1"` and a test database, plus:
```yaml
  web:
    <<: *node
    command: sh -c "npm run build -w apps/web && npm run preview -w apps/web -- --host 0.0.0.0 --port 4173"
    environment: { <<: *node-env, API_PROXY_TARGET: "http://api:3000" }
  playwright:
    image: mcr.microsoft.com/playwright:v<x>-noble     # equal to @playwright/test
    user: "${UID:-1000}:${GID:-1000}"
    working_dir: /app
    volumes: [".:/app"]
    environment: { HOME: /tmp, BASE_URL: "http://web:4173", MAILPIT_URL: "http://mailpit:8025", CI: "${CI:-}" }
    depends_on: [web]
    command: npx playwright test
```
`scripts/test-e2e.sh` follows `test-docker.sh`, with project name `<repo>-e2e` so it never touches dev data, and passes arguments through to `playwright test`. Playwright waits for `${BASE_URL}/api/health` in `globalSetup`. Reports land in `playwright-report/` through the bind mount. The same specs run against staging by setting `BASE_URL` (see `/ship-requirement`).

## WSL notes
- Keep the repo inside the Linux filesystem (`~/…`), not under `/mnt/c`. Bind mounts there are slow and file watching breaks.
- Docker Desktop's WSL integration must be on for this distro.
- Set memory in `%UserProfile%\.wslconfig` (`memory=8GB` or more) for parallel waves. Each package runs its own MySQL and Valkey during tests.
