# Viper (public name: Llyner Leads)

Viper finds the businesses most likely to buy what you sell, with verified contacts and the reason each one fits. Full context: docs/product.md.

## Before you work
- Stack and hosting: docs/architecture/stack.md (source of truth; don't re-decide)
- Domain terms: docs/glossary.md (use them exactly)
- Module boundaries: docs/architecture/context-map.md
- Design system: DESIGN.md (Midnight; use its tokens, never hard-coded colours)
- Decisions: docs/adr/

## Rules that matter here
- Customer-facing text (UI, emails, page titles) says **Llyner Leads**; "Viper" is the code name only.
- B2B public data only; store a Source for every fact (ADR 0007). The Removal list is deferred in the first version.
- Tests never call real providers or Claude; use fixtures and fake Tools (ADR 0005).
- Credits move only through the billing ledger (ADR 0009).
- Provider keys and SMTP live encrypted in Platform settings, never in env or the repo (ADR 0012).
- Research runs must stay resumable: store progress and every Tool call before moving on (PRD first-version FR-19).

## Mocks
- Every mock (screens, flows, nav maps) goes on a **Design artifact** canvas. Every new requirement shows its workflow before and after; every UI change shows mobile and desktop, before and after. Rules: `.claude/skills/new-requirement/references/visual-mocks.md`; registry: `docs/design/mocks.md`.

## Commands
Everything runs in Docker through `./dev`. The host has no Node: never run `node`, `npm` or `npx` directly.
- `./dev install`, `./dev up`, then `./dev seed`: local app at http://localhost:5173, test mail at http://localhost:8025
- `./dev test [paths]`: Vitest in Docker (the result that counts)
- `./dev e2e [specs]`: Playwright acceptance tests
- `./dev lint && ./dev typecheck`, or `./dev check` for everything
- `./dev add <pkg> -w apps/<x>` to add a dependency

## Workflow
New feature: /new-requirement → /build-requirement → /ship-requirement. Small change or bug fix: /small-change.
Deploys: k3s on our own server (ADR 0022): manifests in `deploy/k8s`, workflow `.github/workflows/deploy.yml`, guide `docs/ops/kubernetes-setup.md`. Never deploy without the founder's explicit OK.
