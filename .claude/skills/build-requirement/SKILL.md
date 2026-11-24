---
name: build-requirement
model: opus
description: Build a PRD (docs/prd-*.md) into production-quality, tested code by orchestrating parallel agents along the PRD's execution plan. It covers the DDD/hexagonal Node.js API, the React frontend, Vitest and Playwright in Docker, a demo and sign-off after every wave, and a commit per wave. Use this when the user wants to build, implement or code a PRD or spec from docs/ ("build-requirement", "implement prd-x", "start building the feature we specced"). Not for bug fixes or small tweaks without a PRD (use /small-change), and not for deploying (use /ship-requirement).
---

# Build Requirement

You are the **orchestrator**. You turn a PRD into working, tested code by running its execution plan: you start agents for the work packages, integrate their work between waves, demo each wave to the user, and keep everything green. You write the shared wiring yourself; agents write the features.

The PRD's FRs and acceptance journeys (AJs) are the contract. Each one ends with code and a passing test that proves it.

## Read first
- `docs/architecture/stack.md`: the stack and hosting facts (the source of truth; don't re-decide them). If it's missing, stop and suggest `/product-context`.
- `docs/glossary.md`, `docs/architecture/context-map.md`, `docs/adr/`: names, boundaries, decisions.
- The PRD, in full. Pay particular attention to §6 (FRs), §6a (journeys), §7 (interfaces), §8 (data), §8a (seed) and §16 (execution plan).
- `references/orchestration.md`: how to run waves, the agent brief, and the between-wave checklist.
- `references/architecture.md`: the backend structure you'll be reviewing against.

## Workflow

### 1. Preflight
- **Docker:** `docker info` and `docker compose version` must work (on WSL: Docker Desktop with WSL integration, or Docker Engine inside WSL). If not, tell the user and stop.
- **Blocking questions:** if PRD §14 has open questions that change behaviour, ask them now. A wrong business rule baked into tested code is expensive. Decide minor gaps yourself and record them.
- **Plan check:** validate §16 against `references/orchestration.md` (disjoint ownership in parallel waves, contracts first, at most 4 packages per wave, a demo per wave) and against the current repo. If there's no plan, draft one with `.claude/skills/new-requirement/references/execution-plan.md`.
- **Git:** ask once: "I'll work on branch `feat/<slug>` and commit after each green, signed-off wave. OK?" If the repo has no commits yet, make an initial commit first, with the user's OK. Per-wave commits give you restore points and let you check ownership per wave.
- **Mocks:** the PRD's §6b links the approved Design canvas. Wave demos compare the built screens with its "after" artboards. If the build must differ from a mock, mock that difference (mobile and desktop, before and after; see `.claude/skills/new-requirement/references/visual-mocks.md`) and get approval before building it.
- **Confirm:** show the waves, packages, models and demos, along with any fixes you made to the plan, and wait for the user's go. Don't re-present the whole design the PRD already contains; show only what changed.

### 2. Run the packages
Follow `references/orchestration.md`. Packages are scheduled by their dependencies; waves are milestones.
1. Note the starting commit.
2. Start every **ready** package (all `depends_on` done) **in one message**, so they run in parallel, each with a self-contained brief and its model. Whenever a package finishes, check its ownership and its own tests, then immediately start whatever became ready; don't wait for the rest of its wave.
3. Handle early returns (contract defects, missing dependencies) as they arrive.
4. When all packages of a wave are done (the milestone): wire in the new work, install requested dependencies, run the full checks, and fix failures by sending them back to the owning agent.
5. **Demo**, then wait for the user's sign-off, unless the user asked for autopilot (then report at the end). A fix goes back to the owning agent; a changed requirement updates the PRD (version bump and change log).
6. Commit the milestone.

Never start a package on code that fails its dependencies' tests.

### 3. Final wave: hardening and review
Run the security checklist and the senior review in `references/orchestration.md`. Use an `opus` review agent that is given the diff and the PRD, not your conclusions. Route its findings to fixes, then run everything again:

```bash
./dev check   # lint, typecheck, test, e2e, build: all in Docker
```

Then check coverage: every FR maps to passing tests, every AJ to a passing Playwright spec, and every §3a analytics event is emitted and tested. If something can't be finished, say so plainly.

### 4. Hand off
- **PRD:** status `Built`, plus §17 Implementation notes: FR → test files, AJ → specs, sign-off per wave, and decisions made.
- **Product docs:** roadmap status `Built` (`Shipped` is set by `/ship-requirement`), plus glossary, context-map and ADR updates you've collected from agents' reports.
- **Summary to the user:**
  - waves run and the model used for each package
  - modules and features built, and new migrations
  - test counts
  - deferred items
  - rough agent usage (number of agents, retries)
  - next step: `/ship-requirement`
