---
name: product-context
model: opus
description: Set up or update a product's foundation docs: vision, business model, personas, riskiest assumptions, glossary, bounded-context map, the technical stack (docs/architecture/stack.md), architecture decision records, and CLAUDE.md. Every other product skill reads these first. Use this for a brand-new product or a repo without docs/product.md (run it before /new-requirement), and whenever the user says "product context", "set up the product", "vision", "business model", "glossary", "context map", "change the stack", "record a decision" or "ADR".
---

# Product Context

A product is built through many PRDs. Without a shared base, each PRD re-asks the same questions, names the same thing differently and draws module boundaries differently. These docs are that base: short, living, version-controlled next to the code, and read first by every other skill.

Most startups fail by building the wrong thing well, so this skill also writes down the business model and the riskiest assumptions. PRDs then aim at testing those assumptions, not just adding features.

## The docs

| File | Purpose |
|---|---|
| `docs/product.md` | Vision, problem, personas, value proposition, business model and pricing, competitors, riskiest assumptions, principles, metrics, roadmap, non-goals, constraints |
| `docs/glossary.md` | Ubiquitous language: each term, its meaning, owning context, words to avoid |
| `docs/architecture/context-map.md` | Bounded contexts (each is an API module plus web feature), what each owns, relationships, mermaid diagram |
| `docs/architecture/stack.md` | **The single source of truth for the stack and hosting facts.** Every skill reads it; none hardcode it |
| `docs/adr/NNNN-<slug>.md` | One record per lasting decision: context, decision, alternatives, consequences |
| `CLAUDE.md` | Short project brief for every Claude session: what the product is, key commands, pointers to the docs above |

Templates: `references/templates.md`. Default stack to propose: `references/default-stack.md`.

**Who edits what:** this skill owns `product.md` (except the roadmap table), `stack.md` and `CLAUDE.md`. `/new-requirement` and the `/build-requirement` orchestrator may add roadmap rows, glossary terms, context-map changes and ADRs. Build sub-agents never edit these docs; they report proposed changes instead.

## Workflow

### 1. Check what exists
Read `docs/`, `CLAUDE.md` and the repo. If the docs exist, you're updating: summarise what's there, ask what changed, and edit only that.

### 2. Interview (first time)
Ask a few grouped, numbered questions per round, with suggested answers where sensible.

1. **Vision & problem**: what it is, the problem, for whom, why now, and why current alternatives fall short.
2. **Customers & users**: 2–4 personas (role, goal, pain, how often they use it). Who pays and who uses, if they differ.
3. **Business model**: how it makes money (subscription, usage, marketplace fee…), rough pricing, acquisition channel, and the 2–3 main competitors and how you'll differ.
4. **Riskiest assumptions**: what must be true for this to work ("restaurants will pay €30/month", "users will invite colleagues"). Rank them, and say how each could be tested cheaply.
5. **Success**: one north-star metric and 2–3 supporting metrics, with targets.
6. **Domain**: the main business capabilities and nouns. Listen for the user's own words; they become the glossary.
7. **Scope & roadmap**: the first release (the smallest thing that tests the top assumption), what comes later, non-goals.
8. **Constraints & hosting facts**: budget, deadline, team, compliance (GDPR if serving the EU), markets and languages. For hosting, ask for the **exact Node.js versions the cPanel "Setup Node.js App" offers** and the **exact database server and version** (MySQL 8.0, 8.4 or MariaDB 10.x; cPanel → MySQL Databases or phpMyAdmin shows it), plus the domain names. The Docker images are pinned to these, so tests match production.

### 3. Model the domain
Propose:
- **Bounded contexts**: cohesive capabilities, each owning its data and terms. A word meaning different things in two areas ("account" in billing vs identity) signals two contexts. Start with fewer, larger contexts; splitting later is cheaper than merging. Almost every product has an `identity` context (users, sessions, roles).
- **Relationships**: who calls whom, and where events are used. No cycles.
- **Glossary**: every term in one sentence, with its owning context.

Show them as a short list plus a mermaid diagram and refine together. These boundaries become modules, so getting them roughly right now saves rewrites.

### 4. Confirm the stack
Propose the stack from `references/default-stack.md`, filled in with the hosting facts from step 2. Walk the user through only the choices that are genuinely open for their product (for example, analytics provider or UI kit). Everything else stays at the default unless they object.

### 5. Write the docs
- Write all the files above from the templates.
- Write the initial ADRs: `0001-modular-monolith-ddd`, `0002-mysql-kysely-on-cpanel`, `0003-single-origin-api-under-api-path`, `0004-session-cookie-auth`, `0005-tests-in-docker`, `0006-bundled-api-deploy`. Add any others you decided in step 4.
- Keep every doc short and scannable. They're read at the start of every skill run, and long docs get skimmed.

### 6. Hand off
Summarise: the personas, business model, top riskiest assumption, the contexts, the stack (one line), and the ADRs written. Suggest the next step: `/new-requirement <first roadmap item>`, which should be the slice that tests the top assumption.

## Updating later
- **New term:** add it to the glossary. If it clashes with an existing term, ask which one wins.
- **Context added or changed:** update the map and diagram, and write an ADR if a boundary moved.
- **Stack change:** write a new ADR (mark the old one `Superseded by NNNN`), then update `stack.md` and `CLAUDE.md`. Never delete ADRs; the history is the point.
- **Assumption tested:** record the result in `product.md` (validated, invalidated or still open) and adjust the roadmap.
