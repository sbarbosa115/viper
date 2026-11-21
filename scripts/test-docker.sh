#!/usr/bin/env bash
# Vitest in Docker with its own MySQL, Valkey and Mailpit per COMPOSE_PROJECT_NAME.
# TEST_KEEP=1 keeps that stack running between runs (a fresh app_test database, Valkey and
# Mailpit each run), which skips the MySQL start-up; stop it with `./dev test-down`.
set -euo pipefail
cd "$(dirname "$0")/.."
f=docker-compose.test.yml
export UID GID="$(id -g)"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")-test}"
if [[ "${TEST_KEEP:-}" == 1 ]]; then
  docker compose -f $f up -d --wait db valkey mailpit >/dev/null
  docker compose -f $f exec -T db mysql -uroot -ptest \
    -e 'DROP DATABASE IF EXISTS app_test; CREATE DATABASE app_test' 2>/dev/null
  docker compose -f $f restart valkey mailpit >/dev/null
  docker compose -f $f up -d --wait valkey mailpit >/dev/null
else
  trap 'docker compose -f $f down -v --remove-orphans >/dev/null 2>&1' EXIT
fi
docker compose -f $f run --rm tests npx vitest run "$@"
