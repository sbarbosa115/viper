# Agent guide (for work-package agents)

You are implementing **one work package** of a PRD. Your brief says which package, which FRs, which files you own, and which test project name to use. The orchestrator handles everything outside your package. You never talk to the user.

## Read
- Your brief (the FRs and acceptance criteria are copied into it).
- `docs/architecture/stack.md` and `docs/glossary.md`. Use glossary terms for names in code and UI.
- PRD §7 (interfaces) and §8 (data), for your endpoints and tables only.
- Backend: `.claude/skills/build-requirement/references/architecture.md`, plus `auth.md` if you touch permissions.
- Web: `.claude/skills/build-requirement/references/frontend.md`.
- `.claude/skills/build-requirement/references/testing.md`.

## Hard rules
- **Write only inside your `owns` globs.** Read anything. If you need a change outside them (a contract, a shared file, a `package.json`), don't make it. Report it instead (see *Early return*).
- **Never run `./dev install`, `./dev add`, `./dev remove`, or any `npm install`/`npx <tool>` that installs packages.** Never run `node` or `npm` directly on the host: it has no Node. Dependencies are installed by the orchestrator. If one is missing and you're blocked, return early.
- **Don't commit or touch git state** (no commit, checkout, stash or reset). The orchestrator commits per wave.
- **Don't edit** `docs/` (glossary, ADRs, PRD). Put proposed doc changes in your report.
- Other agents are editing other folders in the same working tree right now. Errors in files you don't own are not yours to fix. Ignore them, and mention them in your report only if they block you.

## Method: test-first, one FR at a time
Finish each FR through all of your layers before starting the next.
1. **Domain**: unit tests from the acceptance criteria (invariants, transitions, rejected inputs). Watch them fail, then implement. Pure TypeScript, no I/O.
2. **Application**: test the use case with in-memory fakes from `modules/<x>/test/`. Cover the happy path, each rule failure, not-found and authorization.
3. **Infrastructure**: the Kysely repository, tested against real MySQL (`*.int.test.ts`). Need a schema change? Add a new migration `apps/api/migrations/<YYYYMMDDHHmmss>_<module>_<change>.ts` and update your module's `infrastructure/tables.ts`.
4. **HTTP**: routes using the contract schemas, tested with `buildTestApp({ modules: [<yours>] })` and `inject()`. Cover status codes, validation errors, auth and response shape.
5. **Web**: hooks, components and pages, tested with Testing Library and your feature's MSW handlers (`features/<x>/test/handlers.ts`, whose responses must parse against the contract).
6. **Analytics**: if the PRD's §3a lists an event for your FR, emit it through the `AnalyticsTracker` port and assert it in the application test.
7. **Seed**: if PRD §8a lists data for your module, implement `seed(deps)` in your `index.ts` using your use cases.

Name tests after requirements: `describe('FR-3: cancel order', …)`, `test('AJ-1: …')`.

## Commands
```bash
# There is no Node on the host: every command goes through ./dev (Docker).
# your tests, with your own MySQL and Valkey (the result that counts)
COMPOSE_PROJECT_NAME=<project> ./dev test <your paths>
# lint only your files
./dev lint <your owned dirs>
# typecheck; ignore errors in files you don't own
./dev typecheck
```

## Early return
Stop and return immediately, without finishing, when:
- **A contract is wrong or missing a field** you need. Return the exact Zod diff you need.
- **A dependency is missing.** Return the package name and why it's needed.
- **The PRD is ambiguous on a business rule.** Return the question and your suggested answer.

The orchestrator fixes the problem and resumes you with a message. Guessing creates mismatches that another agent has to unpick.

## Progress file
Append a line to `.build/<package-id>.md` after each FR (FR, status, test files). If you run out of context or crash, a replacement agent resumes from it. You own this file.

## Final report (short)
```
Package: <id>   Status: done | partial | blocked
FR → tests: FR-1 → modules/orders/domain/order.test.ts, …   (all passing: yes/no)
Test counts: <n> passed, <n> failed (from the Docker run)
Wiring needed: register ordersModule in app.ts; route /orders in router.tsx; seed order
Requests: contract changes / dependencies / shared-file changes (exact)
Doc proposals: glossary terms, ADRs
Decisions on gaps: …
Unfinished / known issues: …
```
Report failures honestly. A "partial" with clear notes is far more useful than a false "done".

## Engineering standards
- **The domain is framework-free.** No Fastify, Kysely, Zod or `process.env` in `domain/`.
- **Make illegal states unrepresentable.** Value objects validate on creation. Entities change only through intention-revealing methods (`order.cancel()`), never setters.
- **Typed errors** (`ValidationError`, `NotFoundError`, `ConflictError`, `ForbiddenError`, `DomainRuleViolation`), mapped to HTTP only in the central error handler.
- **Validate at the edge** with the contract schemas. Trust the types inside.
- **Inject Clock and ID generator.** No `new Date()` or `randomUUID()` in domain or application code.
- **Transactions** belong to use cases (Unit of Work), not to repositories or routes.
- **Authorization** lives in use cases (see `auth.md`), not only in routes.
- **Money** in integer minor units, **time** stored as UTC, **IDs** as UUIDs.
- **Lists are always paginated.** No N+1 queries (load relations in batches).
- Small functions, domain names, no dead or commented-out code, and no `any` without a comment explaining why.
