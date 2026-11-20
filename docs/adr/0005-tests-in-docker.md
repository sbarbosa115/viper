# 0005. Tests run in Docker

- Status: Accepted
- Date: 2026-11-18

## Context
Results must not depend on the developer's machine, and repository tests need a real MySQL (and Valkey for queue tests).

## Decision
Vitest and Playwright run in Docker Compose with MySQL and Valkey images matching production. `npm run test:docker` is the result that counts. External providers are never called in tests: Tool adapters are tested against recorded fixtures, and the agent runs against fake Tools.

## Consequences
Slightly slower feedback than running locally; no "works on my machine". Fixtures must be refreshed when a provider changes its response.
