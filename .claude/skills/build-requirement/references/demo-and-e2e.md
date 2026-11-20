# Demos, seed data and acceptance tests

## Why
The user sees the product after every wave, not only at the end. A misunderstanding caught after Wave 1 costs minutes; caught after the last wave, it costs a rebuild. The PRD's acceptance journeys (§6a) serve twice: as the checklist for each demo, and as Playwright specs that keep those journeys working from then on.

The environments are in `docker.md`. The demo runs at `http://localhost:5173`, with the API docs at `/api/docs` (`@fastify/swagger-ui`, generated from the Zod contracts, disabled in production). That makes backend-only work demoable too.

## Seed data
- `apps/api/src/scripts/seed.ts` (owned by the orchestrator) calls each module's exported `seed(deps)` in dependency order. Each module's seed implements its part of PRD §8a.
- **Idempotent:** it first truncates every table in reverse dependency order (with `SET FOREIGN_KEY_CHECKS=0`), then loads the data. It's safe to run before every demo.
- Builds data **through the use cases**, not raw inserts, so seeded data follows the same rules as real data.
- Uses fixed demo credentials (`<role>@demo.test` / `demo1234`) and refuses to run when `NODE_ENV=production`.

## Playwright
```
e2e/
  playwright.config.ts    # baseURL from BASE_URL, retries: CI ? 1 : 0, trace and screenshot on first retry
  global-setup.ts         # waits for /api/health
  fixtures.ts             # loginAs(role), resetData(), page objects for repeated flows
  aj-1-place-order.spec.ts
```
Rules:
- One spec per journey, named after it: `test('AJ-1: customer places an order and sees it in history', …)`. Follow the PRD's steps, and assert the **Expected** outcome as the user sees it.
- Use role-based locators (`getByRole`, `getByLabel`). If a journey can't be written that way, the UI has an accessibility problem; fix the UI, not the test.
- Each test starts from a known state. `resetData()` calls `POST /api/test/reset`, which reseeds. That route is registered only when `ENABLE_TEST_HOOKS=1` **and** `NODE_ENV !== 'production'`; the final-wave security check verifies this.
- Never use `waitForTimeout`. Rely on auto-waiting and web-first assertions.
- Tag the 2–3 most critical journeys `@smoke` (`test('AJ-1: … @smoke', …)`). `/ship-requirement` runs those against staging, so they must work with a normal test account and must not depend on `resetData()`.
- Keep the suite to journeys, a few minutes in total. Edge cases belong in the lower layers.
- Write a spec in the wave that completes its journey (see the execution plan), so it protects that journey from then on.
