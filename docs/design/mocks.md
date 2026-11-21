# Mocks registry

Where the approved mocks live, and which boards show the app **as it is now** (the baseline that the next change's "before" boards start from). Rules: `.claude/skills/new-requirement/references/visual-mocks.md`.

## Current baseline
| Area | Canvas | Boards | Status |
|------|--------|--------|--------|
| Customer app screens (Midnight) | [Viper prospecting proposal](https://claude.ai/artifact/1hDti46b9PisXsVmHn13kS) | Midnight row: MWelcome, MPlan, MWorking, MLeads, MLeadDetail, MFlows, MFlowEditor, MCredits, MAdmin, MHome | Desktop only; mobile artboards still to add |
| All app screens, clickable (desktop) | [Llyner Leads App Screens](https://claude.ai/artifact/1DYM1YFA2fMHHQLrXHgWXY) | 28 screens: site and sign-in, customer app, back office | Desktop only; mobile to add. Approved 2026-11-19 |
| Back office Expenses (P&L, Expenses, Provider invoices, budget email) | [Llyner Leads Expenses](https://claude.ai/artifact/3W8Y6GFaySsrvnkc7diuC8) | After boards: PnlMobileAfter, PnlDesktopAfter, ExpMobileAfter, ExpDesktopAfter, ExpFormMobileAfter, InvMobileAfter, InvDesktopAfter, EmailBudgetAlert; back-office nav gains Expenses | Mobile and desktop. Approved 2026-11-20 (not built yet) |
| Navigation map | [Llyner Leads Navigation Map](https://claude.ai/artifact/WFQ2BzxSvSxbhwFaUTgz1v) | — | HTML page made before the Design-artifact rule; move it to a Design canvas |

## Requirements
| PRD | Canvas | Workflow row | Screen rows | Approved |
|-----|--------|--------------|-------------|----------|
| prd-first-version | — | — | — | Not yet (written before the mock rules) |
| prd-first-version (landing page and /app routes, v0.2) | [Llyner Leads Landing Page](https://claude.ai/artifact/SzcSuuq9Nz1ALirN1nTiPb) | FlowBefore / FlowAfter | Landing: LandingMobileBefore, LandingDesktopBefore, LandingMobileAfter, Main (desktop after); Navigation: NavBefore / NavAfter; After login: AppMobileBefore, AppDesktopBefore, AppMobileAfter, AppDesktopAfter | Approved 2026-11-19 |
| prd-first-version v0.2 (run attempts, handoff, flow-level limits) | [Llyner Leads Run Retries](https://claude.ai/artifact/DpVT9k1m85Lxqor35ZPLDg) | FlowBefore / Main (after) | Settings→Research flows, Runs list, Run detail, Working on it: mobile and desktop, before and after | Approved 2026-11-19 |
| prd-expenses | [Llyner Leads Expenses](https://claude.ai/artifact/3W8Y6GFaySsrvnkc7diuC8) | FlowBefore / Main (after) | P&L, Expenses, Provider invoices: mobile and desktop, before and after; Email: EmailBudgetAlert | Approved 2026-11-20 |
