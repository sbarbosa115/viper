---
name: small-change
description: The fast path for bug fixes, small tweaks and minor additions that don't need a PRD, such as fixing a bug, changing a validation rule, adding a field or a filter, adjusting copy or layout, or a small refactor. It works test-first in the main session, with the same architecture and quality bar as /build-requirement but no waves, agents or PRD. Use it whenever the user reports a bug or asks for a change that touches one module or feature and roughly a day of work or less. If the change needs new screens, new modules, new business rules across contexts, or product decisions, recommend /new-requirement instead.
---

# Small Change

Most day-to-day work is small. It deserves the same quality bar as a big feature, without the ceremony. Keep it fast: no interview marathon, no execution plan, no parallel agents.

## 1. Understand and size it
- Read `docs/architecture/stack.md`, `docs/glossary.md`, `CLAUDE.md`, and the code involved.
- Restate the change in one or two sentences, with its acceptance criteria as Given/When/Then. For a bug: the steps to reproduce, the expected result and the actual result.
- **Size check.** It's small if it stays inside one module and/or one feature, needs at most one migration and no new contracts beyond adding fields, and involves no open product questions. If it's bigger, say so and suggest `/new-requirement`. Proceed only if the user still wants the fast path.
- Ask only the questions that block you, in one round, each with a suggested answer.
- **If the change touches any UI view**, mock it before coding, following `.claude/skills/new-requirement/references/visual-mocks.md`. On a Design artifact, add one row per affected screen with four artboards: mobile before, desktop before, mobile after, desktop after. If the user's flow changes, also add a workflow row comparing it before and after. Get approval, then record the canvas in `docs/design/mocks.md`.

## 2. Work on a branch
Ask once whether to use a `fix/<slug>` or `chore/<slug>` branch and commit at the end. Don't commit without that OK.

## 3. Test first
- **Bug:** first write a test that reproduces it, at the lowest layer that can show it, and watch it fail. Then fix it. The test stays as a regression guard.
- **Change:** update or add the tests for the new behaviour, then implement.
- Follow the layer rules and engineering standards in `.claude/skills/build-requirement/references/agent-guide.md` and `architecture.md`: domain stays framework-free, typed errors, validation at the edge, authorization in use cases.
- If a contract changes, update `packages/contracts`, the API, the web hooks and the MSW handlers together, in one change.
- If a migration is needed, make it additive and safe to roll back (no drops or renames in the same release).
- If the change touches a PRD acceptance journey, run or update its Playwright spec.

## 4. Verify
```bash
./dev lint && ./dev typecheck && ./dev test   # all in Docker; the host has no Node
```
Add `./dev e2e` when a user journey is affected. Never run `node` or `npm` directly on the host. Read your own diff as a reviewer would before calling it done.

## 5. Hand off
- Summarise: the cause (for bugs), what changed, the tests added, and the results.
- If the change altered behaviour described in a PRD, update that PRD (a version bump and a change-log row) so the docs stay true.
- Add new terms to the glossary, if any.
- If a UI view changed, update `docs/design/mocks.md` so the approved "after" boards are the current baseline.
- Suggest `/ship-requirement` when the user wants to release it.
