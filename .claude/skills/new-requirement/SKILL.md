---
name: new-requirement
model: opus
description: Turn a feature idea into a complete, build-ready PRD at docs/prd-<slug>.md. It interviews the user, mocks the workflow and screens before and after on a Design artifact, models the domain, defines acceptance journeys and success measurement, and writes an execution plan of parallel work packages for /build-requirement. Use this whenever the user wants to plan, spec or scope a feature or the next roadmap item, write a PRD/spec, or says "new requirement", "let's plan X", "I want to add…". It needs docs/product.md; for a brand-new product without it, run /product-context first. Not for bug fixes or small tweaks (use /small-change).
---

# New Requirement → PRD

Turn a rough idea into a PRD complete enough that `/build-requirement` can build it, with parallel agents, without coming back to ask basic questions. The interview is how you get there; the PRD is the deliverable.

"Done" means: every FR is testable, every acceptance journey is walkable, every endpoint has its request/response shape, every open question is answered or listed, and the execution plan can be run as written.

This skill runs on the strongest model (`model: opus`): mistakes are cheapest to catch here and most expensive to miss.

## Workflow

### 1. Load context
Read, in this order:
1. `docs/architecture/stack.md`: the stack and hosting facts. **Don't re-decide them.** Only discuss a deviation if the feature genuinely needs one, and that requires a new ADR.
2. `docs/product.md`, `docs/glossary.md`, `docs/architecture/context-map.md`, `docs/adr/`: vision, personas, riskiest assumptions, terms and boundaries. Use glossary terms exactly, and place the feature in existing contexts unless it truly needs a new one.
3. Existing `docs/prd-*.md` (to avoid overlap and duplicate slugs) and the code (which modules and features already exist).

If `docs/product.md` or `stack.md` is missing, stop and recommend `/product-context`. Everything here builds on it.

Restate the idea in one or two sentences. Say which persona it serves and which riskiest assumption (A-n) it helps test. If it tests none, ask whether it belongs on the roadmap now.

### 2. Interview
Ask as many questions as you need. A gap here becomes a wrong guess in code. Still, respect the user's time:
- Group questions by topic, a few at a time, numbered so the user can answer briefly.
- Suggest an answer for each question; users often just accept it.
- Follow up on vague answers ("manage their stuff" → which stuff, which actions?). Probe edge cases, errors, limits and permissions.
- Skip whatever the docs and code already answer.
- "You decide" → choose sensibly and record it under *Assumptions & decisions*.

Topics (detailed prompts in `references/question-bank.md`):
1. **Goal & measurement**: the user problem, the success metric with a target, and the events that will prove it.
2. **Users & permissions**: which personas and roles, and who can do what.
3. **Scope**: user stories, the smallest shippable version (the cut line), later items, non-goals.
4. **Functional detail**: per story: inputs, rules, validation, outputs, errors, edge cases, notifications, scheduled work.
5. **Screens & UX**: screens, the main flow, the empty, loading and error states, and anything the user has sketched.
6. **Interfaces**: endpoints with request/response fields, external integrations and webhooks.
7. **Data**: entities, fields, relationships, volume, retention, migration of existing data.
8. **Non-functional**: performance targets, security and privacy (personal data, GDPR), accessibility, i18n.
9. **Risks & open questions.**

Before designing the plan, summarise the key decisions and ask "anything missing or wrong?"

### 2b. Mock the workflow and the screens (Design artifact)
Follow `references/visual-mocks.md`. On a **Design artifact** (the canvas with artboards, never a plain HTML page):
- **Workflow row:** the user's flow **before** (today, from the boards listed in `docs/design/mocks.md`) next to the flow **after** this requirement, with new, changed and removed steps marked.
- **Screen rows:** for every screen the requirement adds or changes, four artboards: mobile before, desktop before, mobile after, desktop after.

Share the link and get the user's approval, revising the canvas until they approve, before you design the plan and write the PRD. Any mock the user asks for during the interview (navigation map, sitemap, wireframes) also goes on a Design artifact.

### 3. Design the execution plan
Work out how `/build-requirement` splits the build across parallel agents without collisions. Rules and format: `references/execution-plan.md`. In short:
- **Wave 0** (alone): contracts with full request/response/error schemas, migrations and table types, seed, and on the first build only, the scaffold.
- **Feature waves** (parallel): one package per backend module and per web feature, each owning a disjoint set of files, its own tests, and the Playwright spec for the journeys it completes.
- **Final wave**: hardening, security checklist and review.
- Each package gets a model (`opus` for complex domain logic, `sonnet` for well-specified CRUD and UI), its dependencies, and `done_when`. Each wave gets a demo and the journeys it unlocks.

Show the user the plan as two short tables (packages, demos) and adjust as needed.

### 4. Write the PRD
- **Path:** `docs/prd-<slug>.md` (short kebab-case). If it exists, ask whether to update it (bump the version and add a change-log entry) or choose a new slug. Never silently overwrite.
- **Structure:** `references/prd-template.md`. **Keep section numbers stable.** Other skills reference §6a, §7, §8a and §16 by number. If a section doesn't apply, keep its heading with a one-line "Not applicable: <why>".
- **Testable requirements:** every FR gets an ID and Given/When/Then acceptance criteria. Every NFR is measurable ("p95 < 200 ms at 50 req/s", not "fast").
- **Acceptance journeys (§6a):** 3–8 end-to-end user journeys (AJ-n) covering the critical paths plus one or two important failure paths. They become Playwright specs and the demo checklists.
- **Interfaces (§7):** every endpoint with method, path (under `/api`), auth, request fields and response fields, and error codes. Wave 0 turns these directly into Zod contracts, so don't leave the fields for it to invent.
- **Measurement (§3a):** the analytics events, with their properties, that prove each goal.
- **Screens (§6b):** link the approved canvas and name the workflow row and screen rows.
- **Use the user's words** for domain concepts. Mark everything you decided on their behalf under *Assumptions & decisions*.
- Set status `Draft`, version `0.1` and today's date.

### 5. Update the product docs and hand off
- `docs/product.md`: add or update the roadmap row (status `Specced`, linked to the PRD and assumption).
- `docs/glossary.md`: add new terms. `context-map.md`: add or change contexts. Write an ADR for any lasting decision.
- `docs/design/mocks.md`: record the canvas and mark its "after" boards as the current baseline.

Then tell the user: the path, a 3–5 line summary (scope, FRs, journeys, waves and packages), and any blocking open questions. The next step is `/build-requirement docs/prd-<slug>.md`. Don't start implementing.
