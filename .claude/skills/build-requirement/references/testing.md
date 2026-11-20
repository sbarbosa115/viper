# Testing

## Principles
- Tests come from the PRD's acceptance criteria. Write them first, see them fail, then implement.
- Test behaviour through public interfaces, so refactors don't break tests.
- Prefer **fakes** (in-memory implementations of ports) over mocks. Use `vi.fn()` only to verify calls to things with no meaningful state (email sender, analytics tracker).
- Each test sets up its own data with factories. No test depends on another's leftovers.
- Deterministic: inject a fixed `Clock` and ID generator. No real time, randomness or network.
- Name tests after requirements: `describe('FR-3: cancel order', …)`, `test('AJ-1: …')`.
- Tests run only in Docker (`./dev test`); there is no Node on the host. That run is the result that counts.

## What each layer proves

| Layer | Tool | Proves |
|---|---|---|
| domain | Vitest, pure | invariants, transitions, calculations, value-object validation |
| application | Vitest + fakes | happy path, each rule failure, not-found, authorization, analytics events |
| infrastructure | Vitest + real DB (`*.int.test.ts`) | mapping round-trip, queries, constraints, pagination, migrations apply |
| http | Vitest + `buildTestApp` + `inject()` | status codes, validation errors, auth required, response parses against the contract |
| web | Vitest + Testing Library + MSW (jsdom) | user-visible behaviour, forms, loading, empty and error states |
| acceptance | Playwright, full stack | each PRD journey works end to end |

Prove each rule once, at the lowest layer that can prove it. Higher layers prove wiring.

## vitest.config.ts (repo root)
Vitest 4 uses `test.projects`; workspace files were removed. Check the installed major version when scaffolding.
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'contracts', root: 'packages/contracts', include: ['src/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'api-unit', root: 'apps/api', include: ['src/**/*.test.ts'], exclude: ['src/**/*.int.test.ts'], environment: 'node' } },
      {
        test: {
          name: 'api-int', root: 'apps/api', include: ['src/**/*.int.test.ts'], environment: 'node',
          globalSetup: ['./test/global-setup.ts'],   // runs migrations once
          fileParallelism: false,                    // one DB; files run serially
        },
      },
      {
        plugins: [react()],
        test: { name: 'web', root: 'apps/web', include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
      },
    ],
    coverage: { provider: 'v8', include: ['apps/*/src/**', 'packages/*/src/**'] },
  },
});
```
Scripts: `test:docker` (everything, in Docker), `test:unit` (`vitest run --project api-unit --project web --project contracts`, the host-friendly subset), `coverage`. Target ≥ 90% line coverage on `domain/` and `application/`. Don't chase coverage on glue code.

## Integration database
- `apps/api/test/global-setup.ts` reads `DATABASE_URL_TEST`. It **refuses to run unless the database name ends in `_test`**, then runs all migrations once.
- Each integration test file truncates the tables it uses in `beforeEach` (with `SET FOREIGN_KEY_CHECKS=0` around it). That's much faster than recreating the schema.
- **Repository contract tests:** one shared suite per repository port, run against both the in-memory fake and the Kysely implementation. It keeps the fakes honest.

## Fakes (per module, in `modules/<x>/test/`)
```ts
export class InMemoryOrderRepository implements OrderRepository {
  private rows = new Map<string, OrderSnapshot>();
  async findById(id: OrderId) { const s = this.rows.get(id.value); return s ? Order.restore(structuredClone(s)) : null; }
  async save(order: Order) { this.rows.set(order.id.value, structuredClone(order.toSnapshot())); }
}
```
Storing cloned snapshots makes the fake behave like a database: a change made without `save()` is lost, and the test catches the bug.

## HTTP tests
`buildApp(config, deps)` never reads `process.env`; only `main.ts` does. Tests use `buildTestApp`, provided by Wave 0 in `apps/api/test/build-test-app.ts`:
```ts
const app = await buildTestApp({ modules: [ordersModule], deps: { orders: fakeOrdersDeps() }, actor: customer() });
const res = await app.inject({ method: 'POST', url: '/api/orders/abc/cancel' });
expect(res.statusCode).toBe(404);
expect(errorResponse.parse(res.json()).error.code).toBe('NOT_FOUND');
```
`actor` installs a test auth stub. Omit it to test 401 responses. See `auth.md` for testing with real sessions.

## Web tests
- Query by role, label or text. Interact with `@testing-library/user-event`.
- Mock the network with MSW. Each feature owns `features/<x>/test/handlers.ts`, and `src/test/setup.ts` loads every feature's handlers (`import.meta.glob('../features/*/test/handlers.ts', { eager: true })`). Handlers build responses with the contract schemas (`orderResponse.parse(...)`), so a contract change breaks them loudly.
- Cover loading, empty and error states, plus form validation messages.
