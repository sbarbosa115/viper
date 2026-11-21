# Orchestration

The plan format and planning rules are in `.claude/skills/new-requirement/references/execution-plan.md`. This file covers running a plan.

## Scheduling: start packages when they're ready
Waves are milestones, not barriers. Keep a ready queue:
- A package is **ready** when every package in its `depends_on` is done and its owned files aren't owned by a running package.
- Whenever a package finishes, check its ownership (below), run its own paths' tests, and **start every package that became ready, in one message** (at most 4 running at once; see execution-plan.md rule 7). Don't wait for the rest of its wave.
- When **all packages of a wave** are done, run the milestone: wire in, full checks, commit (and the demo, unless on autopilot). A package of the next wave that is already running keeps running; its files are simply not in that commit yet (commit with explicit paths, or `git add -A` and let the next milestone include the rest).
- If a finished package breaks something, the packages depending on it wait; others continue.

## Before starting packages
- The packages they depend on are done, and the build is green for their paths.
- No two packages in a parallel wave have overlapping `owns`. If any do, re-split them or run them in sequence, and tell the user.
- There are at most 4 packages in the wave. If there are more, run them in batches.
- Build the shared test image once (`docker compose -f docker-compose.test.yml build`), so agents don't rebuild it in parallel.
- Record the starting commit: `git rev-parse HEAD` → `W<n>_START`.
- Give each package a Compose project name `<repo>-<package-id>` in lowercase (for example `viper-wp-1`), so each gets its own MySQL and network, and tell it to run tests with `TEST_KEEP=1` (warm stack) and to run `./dev test-down` when it finishes. After a package returns, run `COMPOSE_PROJECT_NAME=<its project> ./dev test-down` yourself in case it didn't.

## Starting agents
- Send all of the wave's Agent calls **in one message**, using `subagent_type: "general-purpose"` and each package's `model`.
- All agents share one working tree. Disjoint ownership plus the agent rules (no installs, no git) make that safe.
- Use `isolation: "worktree"` only for a package marked `isolation: worktree`. It needs a commit to branch from, and you merge its branch afterwards.
- Agents can't see this conversation. The brief is everything they know.
- Background agents stop on permission prompts. If `./dev` or `docker` commands keep prompting, suggest the user allowlist them (for example with `/fewer-permission-prompts`). That's their decision; don't change permission settings yourself.

### Brief template
The brief must be self-contained: **paste** the FR text, endpoints, tables, events and the port signatures it needs. Don't tell the agent to read the PRD in full; every agent re-reading a long PRD is minutes of wasted time and a chance to drift outside its package. Point only to specific files it must imitate (an existing module, a mock file).
```
You are implementing work package <ID>: <title>, in <repo path>.
First read .claude/skills/build-requirement/references/agent-guide.md and follow it exactly.

PRD: <docs/prd-x.md> (v<version>); everything you need from it is below.
Requirements (copied from the PRD):
<FR-n: full text with acceptance criteria, for every FR in the package>
<AJ-n: full text, if this package owns a journey spec>
Endpoints (from §7): <the ones this package implements or calls>
Tables (from §8): <the ones it uses>
Analytics events (from §3a): <the ones for these FRs>

You own (write only here): <owns globs>
Ports you call or provide (exact signatures): <from §7 Module ports>
Code to imitate: <paths of an existing module / feature / mock files>
Compose project name for tests: <repo>-<id> (run with TEST_KEEP=1; ./dev test-down at the end)
Done when: <done_when items>, plus every listed FR has passing tests in your Docker run.
Resume: if .build/<id>.md exists, continue from it.
```

## Handling early returns
Agents return early for contract defects, missing dependencies or ambiguous rules.
- **Contract defect:** fix `packages/contracts` yourself. Then use SendMessage to tell **every** agent in the wave that uses that contract (not only the one that asked) to "resume: contract X changed: <diff>".
- **Missing dependency:** wait until no agent is mid-test, run `./dev add <pkg> -w apps/<x>`, then resume the agent (no image rebuild: `node_modules` is in the bind mount).
- **Ambiguous rule:** answer it from the PRD if you can. Otherwise ask the user, then resume the agent and record the decision in the PRD.
- **Agent died or ran out of context:** start a new agent with the same brief. It resumes from `.build/<id>.md`.

## After each wave
1. **Ownership:** `git status --porcelain` plus `git diff --name-only W<n>_START`. Every changed path must match the owning package's globs, or be in `.build/`. Revert stray edits, or move them to their rightful owner.
2. **Wire in:**
   - register the wave's modules in `app.ts` and `main.ts`
   - add its features' routes to `apps/web/src/app/router.tsx`
   - add its seed functions to `seed.ts`
   - compose the new table types into `shared/infrastructure/db/schema.ts`
   - apply requested shared-file changes and add requested dependencies.
3. **Migrations:** list `apps/api/migrations/`, check that the names are unique and that there are no conflicting changes to the same table. The migrator runs with `allowUnorderedMigrations: true`, so parallel timestamps are fine.
4. **Full checks (only here, once per milestone):** `./dev lint && ./dev typecheck && ./dev test`, plus `./dev e2e` once any spec exists. Agents run only their own paths; the full suite is the orchestrator's job. The MSW handlers and the API's HTTP tests both parse against the contracts, so contract drift fails here too. If something fails, SendMessage the owning agent with the failing output, rather than starting a new agent with no context. Fix trivial wiring problems yourself.
5. **Demo and sign-off.** Run `./dev up`, then `./dev seed`, and post:
   ```
   Wave W1 done: <one line>. Tests: <n> unit/integration, <n> e2e, all green.
   Try it: http://localhost:5173 · API docs: http://localhost:5173/api/docs
   Log in as: admin@demo.test / demo1234 (admin) · user@demo.test / demo1234 (<role>)
   Checklist:
   - [ ] AJ-1, steps 1–3: <do> → <expect>
   - [ ] <anything else new in this wave>
   Reply "go" to continue to W2, or tell me what to change.
   ```
   Wait for the reply. Route fixes to the owning agent (SendMessage) and demo again. A changed requirement means updating the PRD (version bump and change-log row) and adjusting the remaining packages.
6. **Commit:** `git add -A && git commit -m "feat(<slug>): W<n> <wave name>"`, with the attribution footer. `.build/` is gitignored.
7. Tell the user in one line what starts next.

## Final wave: hardening and review
**Security checklist** (fix or report each item):
- every route requires auth unless it's explicitly public, and authorization is checked in use cases
- rate limits on login, signup and password reset
- the seed script and test-only hooks refuse to run when `NODE_ENV=production`
- `./dev npm audit --omit=dev`: no high or critical issues
- no secrets in the repo (`git grep -nE "(password|secret|api[_-]?key)\s*[:=]\s*['\"][^'\"]+"`)
- helmet with a CSP that works with the SPA, `Secure` cookies in production
- personal data handled as PRD §10 says (export, delete, consent)

**Performance:** check the NFR targets on key endpoints (a quick `autocannon` run against the dev stack is enough), look for indexes missing on foreign keys and filter columns, and confirm lists are paginated.

**Senior review:** start an `opus` agent with the PRD path and `git diff <base-branch>...HEAD`. Ask it to review for correctness against the FRs, layer leaks, missing error handling, security, naming, duplication, and testing gaps. Don't share your opinion of the code; let it judge independently. Route its confirmed findings to fixes.
