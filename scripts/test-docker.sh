#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
f=docker-compose.test.yml
export UID GID="$(id -g)"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")-test}"
trap 'docker compose -f $f down -v --remove-orphans >/dev/null 2>&1' EXIT
docker compose -f $f run --rm tests npx vitest run "$@"
