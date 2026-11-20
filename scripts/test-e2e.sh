#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
f=docker-compose.e2e.yml
export UID GID="$(id -g)"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")-e2e}"
trap 'docker compose -f $f down -v --remove-orphans >/dev/null 2>&1' EXIT
docker compose -f $f run --rm playwright npx playwright test --config e2e/playwright.config.ts "$@"
