# Execution plan (PRD §16)

The execution plan tells `/build-requirement` how to split the build across agents. Parallel agents are fast, but they collide when two edit the same file, when one builds against an interface that doesn't exist yet, or when two run `npm install` at once. These rules prevent all three.

## Rules

1. **Wave 0 is thin, runs alone and freezes the interfaces.** Everything else waits for it, so put in it only what other packages build against:
   - *First build only:* the scaffold, as its own package. It is too much to combine with the rest.
   - **Contracts**: Zod schemas in `packages/contracts` for every endpoint in §7, covering request, response and error shapes, plus new error codes.
   - **Schema**: migrations for every table in §8, plus each module's Kysely table types (`modules/<x>/infrastructure/tables.ts`).
   - **Dependencies**: every npm package the PRD needs, installed once.
   - **Skeleton modules and features**: empty `index.ts` files exporting `register`, `routes` and `seed`, so the orchestrator can wire them in before feature packages start.
   - **Cross-module ports**: the exact signatures of any public query one module adds for another (write them into §7 "Module ports"), so both sides can be built in parallel.
   - **Not the seed.** Demo data (§8a) belongs to the module packages that own the tables; each implements its own `seed`. If the demo needs exact cross-module figures, give that check to a small package that depends on them.
2. **Disjoint ownership.** Each package lists `owns` globs. Two packages in a *parallel* wave never overlap. Packages in a sequential wave such as W0 run one after another, so they may hand files over. Agents read anything but write only what they own. Each module or feature owns everything inside its folder, including its tests (`modules/x/**/*.test.ts`), its test fakes and factories (`modules/x/test/**`) and its MSW handlers (`features/x/test/handlers.ts`).
3. **From Wave 1 on, the orchestrator owns the shared files.** No feature package owns these:
   - `apps/api/src/app.ts`, `apps/api/src/main.ts`, `apps/api/src/shared/infrastructure/db/schema.ts`
   - `apps/web/src/app/**`, the `seed.ts` entry point
   - every `package.json` and `package-lock.json`
   - `packages/contracts/**` after Wave 0
   - `apps/web/src/shared/ui/**` after Wave 0
   
   The orchestrator changes them between waves.
4. **Split by bounded context and side.** A typical package is "backend module X" (`apps/api/src/modules/x/**`) or "web feature X" (`apps/web/src/features/x/**`). Web packages can run alongside their backend counterparts, because they test against MSW handlers that parse the contracts.
5. **Journeys are tested in the wave that completes them.** The package that finishes the last piece of a journey owns `e2e/aj-<n>-*.spec.ts`. If a journey needs both a backend and a web package from the same wave, add a small follow-up package in the next wave for the spec. Regression protection starts as soon as a journey works, not at the end.
6. **Depend on outputs, not on waves.** `depends_on` lists the packages whose code this one needs, and it is what the orchestrator schedules by: a package starts as soon as all its `depends_on` are done, even if others in its wave are still running. Waves are milestones (integration, full checks, commit, optional demo), not barriers. Add a dependency only for a real code need (module B calls module A's use case); a port defined in W0 is not one.
7. **Size and concurrency.** A package covers **1–3 FRs** and should finish in under ~15 minutes of agent time. A module with more FRs is split into several packages that own **disjoint subfolders** of it (for example `modules/x/domain/pnl/**` + its tests, `modules/x/{application,http}/expenses/**`, `modules/x/{application,http}/invoices/**`), with the module's `index.ts` and shared files (`ports.ts`, test world) written in W0 or by the orchestrator. Never split an aggregate. **At most 4 packages run at once** (each runs Docker test containers and WSL2's memory is shared); raise it to 6 only if `free -g` shows ≥ 12 GB available while they run.
8. **Every wave ends in a demo.** `demo` says what the user can see or try, and `journeys` lists the AJs it unlocks. If a wave has nothing to show, it is sliced by layer rather than by feature; reslice it.
9. **The final wave is hardening and review**, run by the orchestrator and an `opus` reviewer: the security checklist, performance against the NFRs, PRD coverage, and a full senior code review.

## Model selection
Use aliases so the plan picks up newer models automatically.

| Work | Model |
|---|---|
| Orchestrator, Wave 0 contracts and schema, final review | `opus` |
| The pure core of complex domain logic (money arithmetic, state machines, permission rules), kept to its own small package | `opus` |
| Everything else: use cases and HTTP around that core, CRUD modules, queries, UI pages and forms, jobs and emails, journey specs, seed | `sonnet` (the default) |
| Purely mechanical work (fixtures, copy) | `haiku` |

## YAML format (inside §16)

```yaml
execution:
  orchestrator_model: opus
  waves:
    - id: W0
      name: Foundation
      parallel: false
      demo: "`./dev up` starts the stack; /api/health is green; seeded users can log in"
      journeys: []
      packages:
        - id: WP-0a              # first build only
          title: Scaffold monorepo, Docker, CI
          model: sonnet
          owns: ["*.json", "*.ts", "*.js", "Dockerfile", "docker-compose*.yml", ".github/**", "scripts/**", "apps/*/*.json", "apps/*/*.ts", "e2e/playwright.config.ts", "e2e/fixtures.ts"]
          depends_on: []
          done_when: ["./dev lint, typecheck, test, e2e (smoke) and build all pass on a machine with only Docker", "the production api image boots and /api/health responds"]
        - id: WP-0b
          title: Contracts, schema, module skeletons, seed skeleton, dependencies
          model: opus
          requirements: all
          owns: ["packages/contracts/**", "apps/api/migrations/**", "apps/api/src/modules/*/infrastructure/tables.ts", "apps/api/src/modules/*/index.ts", "apps/web/src/features/*/index.ts", "apps/api/src/scripts/seed.ts", "package.json", "apps/*/package.json", "package-lock.json"]
          dependencies: [stripe]          # npm packages to add
          depends_on: [WP-0a]
          done_when: ["a contract exists for every §7 endpoint", "migrations create every §8 table", "test:docker green"]
    - id: W1
      name: Orders
      parallel: true
      demo: "Place and cancel orders in the UI against the real API"
      journeys: [AJ-1]
      packages:
        - id: WP-1
          title: Orders module (API)
          model: opus
          requirements: [FR-1, FR-2, FR-3]
          owns: ["apps/api/src/modules/orders/**", "apps/api/migrations/*_orders_*"]
          depends_on: [WP-0b]
          done_when: ["each FR has passing domain, application, repository and HTTP tests"]
        - id: WP-2
          title: Orders feature (web)
          model: sonnet
          requirements: [FR-1, FR-2, FR-3]
          owns: ["apps/web/src/features/orders/**"]
          depends_on: [WP-0b]
          done_when: ["pages, hooks and forms tested with Testing Library and MSW"]
    - id: W2
      name: Journey specs and hardening
      parallel: false
      demo: "Full app with seed data; every AJ can be walked through by hand"
      journeys: [AJ-1, AJ-2]
      packages:
        - id: WP-3
          title: Playwright specs for AJ-1, AJ-2
          model: sonnet
          owns: ["e2e/aj-*.spec.ts"]
          depends_on: [WP-1, WP-2]
          done_when: ["each listed AJ has a passing spec"]
        - id: WP-R
          title: Hardening and review
          model: opus
          owns: []                 # review only; fixes are routed to owning packages
          depends_on: [WP-3]
          done_when: ["security checklist passes", "every FR and AJ maps to a passing test"]
```

For a later PRD in an existing repo, drop WP-0a. WP-0b then covers only the new contracts, migrations and skeletons.
