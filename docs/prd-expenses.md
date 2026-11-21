# PRD: Expenses and P&L

| Field   | Value |
|---------|-------|
| Status  | Draft |
| Version | 0.1 |
| Date    | 2026-11-20 |
| Persona | Staff (Viper operator, initially the founder) |
| Tests assumption | A-2: provider cost per qualified lead allows ≥ 60% gross margin; also the founder's monthly budget constraint |

## 1. Overview
A Staff-only **Expenses** area in the back office (`/app/staff/expenses`) that keeps track of everything Llyner Leads costs to run, and sets it against revenue. Staff enter **Recurring bills** (hosting, email, domain, provider plans) once and **One-off expenses** when they happen. Usage costs come in automatically from metered Tool calls, Stripe fees are estimated per sale, and Staff enter each provider's real **Provider invoice** at month end. The **P&L** tab shows each month's revenue, cost of revenue, gross margin, operating expenses and net profit, with a 12-month chart, a category breakdown, CSV export and a monthly **Budget** that emails all Staff at 80% and 100%.

## 2. Problem
Today the only cost the app knows is the Rate card's list price per Tool call. Real bills live in vendor dashboards (DigitalOcean, Resend, the domain registrar, Apify and Firecrawl plans, Anthropic and Google invoices) and a spreadsheet, if anywhere. So:
- The Staff dashboard's gross margin (A-2) uses list prices and leaves out plans, hosting and Stripe fees. If Google bills 35% more than the Rate card says, nobody sees it.
- There is no monthly total, so the founder can't tell whether the business stays within its budget until the card statement arrives.
- Bills are missed or paid twice, and price changes go unnoticed.

## 3. Goals & success metrics
- G-1: Every cost is in one place. Metric: from December 2026, each month's P&L has an invoice or a linked plan for every provider with metered usage by the 10th of the next month (100% of providers).
- G-2: A true gross margin for A-2. Metric: the P&L gross margin uses invoice or plan costs plus Stripe fees for every closed month; any provider whose invoice differs from metered by more than 15% is flagged the day the invoice is entered.
- G-3: No surprise overspend. Metric: a budget alert email reaches every Staff Member within 24 hours of month-to-date spend crossing 80% and 100% of the Budget.

### Non-goals
- Accrual accounting, tax filing, VAT, multiple currencies (USD only).
- Receipt uploads (a link or a note instead).
- Importing bank or card statements; pulling invoices from provider APIs; exact fees from Stripe's balance transactions (later).
- Customer-facing anything: customers never see Expenses.
- Per-Business profitability (later; the dashboard keeps its per-Lead view).
- History before 2026-11-01.

## 3a. Measurement
Server events go to `analytics_events` through the `AnalyticsTracker` port; no personal data in properties.

| Event | When it fires | Properties | Proves |
|-------|---------------|------------|--------|
| `expense_created` | FR-2 or FR-4 succeeds | expense_id, kind (`recurring`/`one_off`), category, cadence (`monthly`/`yearly`/null), covers_provider (bool) | G-1 |
| `expense_price_changed` | FR-3 adds a price version | expense_id, effective_from, old_cents, new_cents | G-1 |
| `provider_invoice_entered` | FR-8 saves an invoice (create or change) | provider, month, metered_cents, invoice_cents, gap_pct, flagged | G-1, G-2 |
| `pnl_viewed` | `GET /api/staff/finance/pnl` returns | month, is_current_month | engagement |
| `pnl_exported` | FR-10 CSV download | from_month, to_month | engagement |
| `budget_alert_sent` | FR-12 sends an email | month, threshold (80/100), spent_cents, budget_cents, recipients_count | G-3 |

## 4. Users & permissions
| Role | Can | Cannot |
|------|-----|--------|
| Staff (two-factor passed) | Everything in this PRD: view, create, edit, end and delete expenses; enter invoices; change the Budget; export | Edit history before 2026-11-01; edit derived lines (usage, Stripe fees) |
| Staff while Acting as | Same (Staff endpoints ignore Acting as) | — |
| Owner / Member | Nothing: endpoints return 403, the nav item is hidden | See any Expenses data |

## 5. Scope
### Cut line (smallest shippable version)
- Ten fixed categories; Recurring bills (monthly/yearly, price versions from a date, end date, "covers usage of" a provider); One-off expenses.
- Automatic lines: metered usage per provider (from Tool calls) and estimated Stripe fees per sale.
- Provider invoices per provider and month, with the single-source rule and the 15% gap flag.
- P&L for a month: revenue (sales minus refunds), cost of revenue, gross profit and margin, operating expenses, net; 12-month chart; category breakdown; fixed run-rate; CSV export.
- Budget (default $300) with progress, banner and alert emails at 80% and 100%.
- Refunds from Stripe reverse revenue in the month refunded.
- Every change in the Audit log.

### Later
- Exact Stripe fees from balance transactions; Stripe payouts.
- Pull invoices from provider billing APIs (Anthropic, Google Cloud).
- Receipts as files; bank CSV import.
- Per-category budgets; forecast to month end.
- Show invoice-adjusted margin on the Staff dashboard and the Tools page.

## 6. Functional requirements

Conventions used below:
- **Month** = calendar month in UTC, written `YYYY-MM`. The first month is `2026-11` (the **history start**); no month before it can be viewed or written. The latest month is the current one.
- **Categories** (fixed, in this order): `hosting` Hosting, `data_providers` Data providers, `ai` AI, `email` Email, `domain_dns` Domain & DNS, `payments_fees` Payments fees, `software_tools` Software & tools, `legal_admin` Legal & admin, `marketing` Marketing, `other` Other.
- **Cost of revenue** = the categories `data_providers`, `ai`, `payments_fees`. Every other category is an **operating expense**.
- Amounts are integer cents (USD), 1..10,000,000 ($0.01–$100,000.00) for anything Staff type in.

### FR-1: Expenses list
**Story:** As Staff, I want one list of everything we pay for so that nothing is missed.
**Rules:**
- The Expenses tab lists Recurring bills and One-off expenses: name, vendor, category, amount (the version in effect today, or the one-off amount), cadence (`Monthly`, `Yearly`, `One-off`), next charge date (recurring and not ended), "covers usage of <provider>" when set, and status (`Active`, `Ends <date>`, `Ended`).
- Filters: category, kind (recurring / one-off), month (for one-offs: those dated in the month; for recurring: those with a Charge in the month). Default: all active Recurring bills plus the selected month's One-offs.
- Totals at the top: fixed run-rate per month (FR-9), this month's charges.
- Automatic lines (usage, Stripe fees) are not listed here; they appear on the P&L and the Provider invoices tab.
**Errors / edge cases:** empty state "No expenses yet. Add your hosting, email and domain bills first." with an Add button.
**Acceptance criteria:**
- Given three active Recurring bills and one One-off dated 2026-11-14, when Staff open Expenses for November 2026, then all four are listed with their amounts and cadences.
- Given a bill with `endsOn` 2026-11-30, when viewing December 2026, then it is shown as `Ended` and has no December Charge.
- Given a Member who isn't Staff, when they call `GET /api/staff/finance/expenses`, then 403.

### FR-2: Add a Recurring bill
**Story:** As Staff, I want to enter a bill once so that it is charged every month or year without me remembering.
**Rules:**
- Fields: name (1–80), vendor (1–80), category, amount (cents), cadence `monthly` | `yearly`, first charge date `startsOn` (≥ 2026-11-01, ≤ today + 366 days), optional `endsOn` (≥ startsOn), optional `coversProvider` (a provider from the Tool catalog, FR-6), optional link (https URL ≤ 2048), optional notes (≤ 500).
- `coversProvider` is allowed only for categories `data_providers` and `ai`, and at most one active bill may cover a given provider on any date (409 otherwise).
- **Charges** are derived, not stored: a monthly bill is charged on the day of month of `startsOn` (clamped to the month's last day, e.g. the 31st → Feb 28); a yearly bill on the anniversary of `startsOn`. A Charge exists for every charge date from `startsOn` up to today, and not after `endsOn`. Its amount is the price version in effect on the charge date (FR-3).
- A Charge dated today or earlier counts in that month's P&L and Budget. Future Charges don't count.
- Creating a bill writes the Audit log (`expense.created`) and fires `expense_created`.
**Errors / edge cases:** 400 with field messages; 409 `PROVIDER_ALREADY_COVERED` naming the other bill; 422 `BEFORE_HISTORY_START` for `startsOn` < 2026-11-01.
**Acceptance criteria:**
- Given today is 2026-11-20, when Staff add "DigitalOcean App Platform", Hosting, $42.15 monthly from 2026-11-05, then the November P&L shows Hosting $42.15 and the Expenses list shows next charge Dec 5.
- Given a yearly "llyner.com" Domain & DNS bill of $14.99 from 2026-11-02, then November shows $14.99, December shows $0.00 for it, and the fixed run-rate includes $1.25 (14.99 / 12, rounded to the cent).
- Given a monthly bill from 2026-11-25 and today 2026-11-20, then November has no Charge for it.
- Given an active bill already covers Apify, when Staff add another bill covering Apify, then 409 `PROVIDER_ALREADY_COVERED`.

### FR-3: Change a bill's price, edit or end it, delete
**Story:** As Staff, I want price changes to apply from a date so that past months stay correct.
**Rules:**
- **Price change:** `{ effectiveFrom, amountCents }` adds a price version. `effectiveFrom` ≥ the bill's `startsOn` and ≥ 2026-11-01; adding a version on a date that already has one replaces that version's amount. Charges dated on or after `effectiveFrom` use it; earlier Charges keep their amount. The edit panel lists the versions ("$20.00 from Nov 18 2026 · $25.00 from Dec 18 2026").
- **Edit:** name, vendor, category, link, notes, `coversProvider`, `endsOn` can be changed. Category and name changes apply to all months (they describe the bill, not a price). The amount can't be edited directly; it changes only through a price change.
- **End:** set `endsOn`; Charges after it stop. Clearing `endsOn` resumes the bill.
- **Delete:** allowed for a One-off, or for a Recurring bill with no Charge yet (dated ≤ today). Otherwise 409 `HAS_CHARGES` ("End the bill instead"). Deletion is soft (`deleted_at`), and the row disappears everywhere.
- Each change writes the Audit log (`expense.updated`, `expense.price_changed`, `expense.ended`, `expense.deleted`) with before/after details.
**Errors / edge cases:** 404 unknown or deleted id; 422 `EFFECTIVE_BEFORE_START`; 400 `endsOn` < `startsOn`.
**Acceptance criteria:**
- Given "Resend" Email $20.00 monthly from 2026-11-18, when Staff add a price change to $25.00 from 2026-12-18, then November still shows $20.00 and December shows $25.00.
- Given a bill with a November Charge, when Staff delete it, then 409 `HAS_CHARGES` and the bill stays.
- Given a bill ending 2026-12-31, when viewing January 2027, then no Charge appears for it.

### FR-4: Add a One-off expense
**Story:** As Staff, I want to record a single payment so that it counts in the month I paid it.
**Rules:** fields: name, vendor, category, amount, date `spentOn` (2026-11-01..today), optional link and notes. It counts in the month of `spentOn`. Edits may change every field, including amount and date (within the same limits). Audit and analytics as FR-2.
**Errors / edge cases:** 422 `BEFORE_HISTORY_START`; 400 future date.
**Acceptance criteria:**
- Given today 2026-11-20, when Staff add "Terms and privacy review", Legal & admin, $300.00 on 2026-11-12, then the November P&L shows Legal & admin $300.00 under operating expenses.
- Given a `spentOn` of tomorrow, then 400 with the field message "Date can't be in the future".

### FR-5: Stripe fees (estimated)
**Story:** As Staff, I want payment fees counted so that gross margin isn't overstated.
**Rules:** for each paid Purchase, the fee is `round_half_up(total × 0.029) + 30` cents, where total = `amount_cents + tax_cents`, dated at `paid_at`. The month's Payments fees line is the sum, shown as "Stripe fees (estimated, 2.9% + 30¢ per sale)". Refunds don't return the fee (Stripe keeps it). Read-only.
**Acceptance criteria:**
- Given paid purchases of $49.00, $49.00 and $99.00 in November, then Payments fees for November are $6.61.
- Given a purchase that is `pending` or `failed`, then it adds no fee.

### FR-6: Metered usage per provider
**Story:** As Staff, I want Tool-call costs to flow in on their own so that usage needs no typing.
**Rules:**
- **Providers** are the distinct `provider` names of the Tool catalog (Anthropic, Apify, Apollo, Firecrawl, Google Maps Platform, Hunter, OpenStreetMap, Twilio, ZeroBounce). Each has a key: the name lowercased with non-alphanumerics replaced by `-` (`google-maps-platform`).
- **Metered cost** of a provider for a month = the sum of `tool_calls.provider_cost_micros` for that provider's Tools with `created_at` in the month, converted to cents with `round_half_up(micros / 10,000)`. Calls of every status count (a failed call that was billed carries its cost; a skipped one is 0).
- Anthropic maps to category AI; every other provider to Data providers.
- Providers with zero metered cost, no plan and no invoice in a month are omitted.
**Acceptance criteria:**
- Given Tool calls in November costing 38,400,000 micros for Anthropic tools, then Anthropic's metered cost is $38.40 and it is counted under AI unless an invoice or plan applies (FR-8).
- Given a Tool call on 2026-11-30T23:59:59Z and one on 2026-12-01T00:00:00Z, then they count in November and December respectively.

### FR-7: Refunds reverse revenue
**Story:** As Staff, I want refunds deducted so that revenue is real.
**Rules:**
- Billing handles Stripe's `charge.refunded` webhook: it finds the Purchase by the Checkout Session's payment intent (stored when the purchase is paid), and sets `refunded_cents` to the charge's `amount_refunded` (cumulative, so partial and repeated refunds are idempotent) and `refunded_at` to the event time.
- Credits are **not** taken back automatically; Staff use a credit adjustment if needed (existing FR-13 of the first version). The back office Customer page is unchanged.
- The P&L counts a refund as negative revenue in the month of `refunded_at`, net of tax: `refunded_cents × amount_cents / (amount_cents + tax_cents)`, rounded half up.
**Errors / edge cases:** unknown payment intent → logged and acknowledged (200), nothing changes; same event twice → no change.
**Acceptance criteria:**
- Given a $99.00 purchase paid in November and fully refunded on 2026-12-03, then November revenue includes $99.00 and December shows a refund of −$99.00.
- Given the same `charge.refunded` event delivered twice, then `refunded_cents` is unchanged by the second.

### FR-8: Provider invoices and the single-source rule
**Story:** As Staff, I want to enter what each provider actually billed so that the P&L uses real costs and I see when the Rate card is wrong.
**Rules:**
- The Provider invoices tab lists, for the selected month, each provider with metered cost, a linked plan, or an invoice: metered cost, invoice or plan amount, gap, the amount that **counts in the P&L** and its source.
- **Single-source rule:** for each provider and month exactly one amount counts:
  1. the **Provider invoice** for that month, if entered; else
  2. the **linked plan**: the sum of Charges in the month of the bill that covers the provider (FR-2); else
  3. the **metered estimate** (FR-6).
  The provider's metered cost never counts on top of an invoice or a plan, and a plan's Charges count only through this rule (they are not added again as a plain bill).
- An invoice is `{ amountCents (0..10,000,000), note? ≤ 200 }` per provider and month; saving again replaces it; deleting it reverts to plan or estimate. Invoices can be entered for the current month and any month since 2026-11.
- **Gap** = (invoice − metered) / metered × 100, one decimal, shown when there's an invoice and metered > 0. **Flagged** when |gap| > 15%, or when metered is 0 and the invoice is > 0. Flagged rows are highlighted with a "Review rate card" link to `/app/staff/tools`, and a banner counts them ("1 gap over 15%").
- With a plan and no invoice, the row shows "N% of plan used" (metered / plan × 100, rounded) instead of a gap; it is never flagged.
- The amount counted goes to the provider's category (FR-6) in the P&L; for a plan, to the plan bill's category.
- Audit: `provider_invoice.saved`, `provider_invoice.deleted`. Analytics: `provider_invoice_entered`.
**Errors / edge cases:** 404 `UNKNOWN_PROVIDER`; 422 `BEFORE_HISTORY_START`, 422 `FUTURE_MONTH`.
**Acceptance criteria:**
- Given Google Maps Platform metered $12.75 in November, when Staff enter an invoice of $17.20, then it counts $17.20 with source `invoice`, gap +34.9%, flagged, and the banner reads "1 gap over 15%".
- Given an Apify plan bill of $49.00 with a November Charge covering Apify and metered $22.10, then Apify counts $49.00 with source `plan`, shows "45% of plan used", and Data providers do not also include the $22.10.
- Given Twilio metered $0.90 and no invoice or plan, then it counts $0.90 with source `estimate`.
- Given an Anthropic invoice of $44.10, when Staff delete it, then Anthropic reverts to its metered $38.40 with source `estimate`.

### FR-9: P&L for a month
**Story:** As Staff, I want a monthly P&L so that I know whether the business makes money and where it goes.
**Rules (cash basis):**
- **Revenue** = sum of `amount_cents` of Purchases with `paid_at` in the month (tax excluded) − refunds in the month (FR-7). Shows sales count.
- **Cost of revenue** = provider costs per the single-source rule (FR-8), grouped into AI and Data providers, + Stripe fees (FR-5) + any bills and One-offs in the categories `data_providers`, `ai`, `payments_fees` that don't cover a provider.
- **Gross profit** = revenue − cost of revenue; **gross margin %** = gross profit / revenue × 100, one decimal, `null` when revenue is 0.
- **Operating expenses** = Charges and One-offs in every other category, by category.
- **Net profit** = gross profit − operating expenses. **Total expenses** = cost of revenue + operating expenses.
- **Category breakdown**: every category with a non-zero amount, largest first, with its share of total expenses.
- **Yearly bills** count in full in the month they're charged; the P&L lists "Yearly bills this month" with each one's monthly equivalent (amount / 12).
- **Fixed run-rate** = sum over active Recurring bills (not ended today) of their current price, yearly ones divided by 12; shown as "$135.40/mo fixed".
- **Trend**: the 12 months ending with the selected month, each with revenue, total expenses and net; months before 2026-11 are `null` and drawn as "no data".
- The current month is labelled "Month to date" and counts only what has happened up to now.
**Acceptance criteria:**
- Given the seeded November 2026 data (§8a), when Staff open the P&L for November, then revenue $197.00 (3 sales), cost of revenue $138.61, gross profit $58.39 (29.6%), operating expenses $384.14, net −$325.75, total expenses $522.75, fixed run-rate $135.40.
- Given no data in a month, then every line is $0.00, gross margin shows "—" and the empty state "Nothing recorded for <Month> yet."
- Given `month=2026-10`, then 422 `BEFORE_HISTORY_START`; given next month, 422 `FUTURE_MONTH`.

### FR-10: CSV export
**Story:** As Staff, I want a CSV so that I can hand the numbers to an accountant.
**Rules:** `GET /api/staff/finance/pnl.csv?from=YYYY-MM&to=YYYY-MM` (≤ 24 months, within history). One row per line item: `month, section (revenue|cost_of_revenue|operating), category, item, source (sale|refund|stripe_fee|invoice|plan|estimate|bill|one_off), amount_usd` (two decimals, refunds negative), then a total row per month per section and a `net` row. Filename `llyner-leads-pnl-<from>-to-<to>.csv`. Fires `pnl_exported`; Audit `pnl.exported`.
**Acceptance criteria:**
- Given November seed data, when Staff export 2026-11 to 2026-11, then the file has a `revenue` total of 197.00 and a `net` row of -325.75, and opening it in a spreadsheet shows no mangled characters (UTF-8 with BOM).
- Given `from` after `to`, then 400.

### FR-11: Budget
**Story:** As Staff, I want a monthly budget so that I see at a glance whether we're over.
**Rules:**
- One platform-wide monthly Budget in cents, default 30,000 ($300.00), range 0..10,000,000; changing it writes the Audit log (`budget.changed`) and applies to the current and future months (past months keep the Budget that was in effect, stored per month when first viewed or alerted).
- **Spent** = total expenses of the month (everything, One-offs included), month to date.
- Progress: `pct = spent / budget × 100` (rounded); status `under` (< 80%), `near` (80–99%), `over` (≥ 100%). Budget 0 → status `over` as soon as anything is spent, pct `null`.
- The P&L shows a progress bar and, when `near` or `over`, a banner ("Over budget: $522.75 of $300.00 (174%)").
**Acceptance criteria:**
- Given November total expenses $522.75 and Budget $300, then the P&L shows 174% and status `over`.
- Given Staff change the Budget to $600 in November, then November shows 87% `near`, and the Audit log has `budget.changed` with old and new values.

### FR-12: Budget alert emails
**Story:** As Staff, I want an email when spend passes 80% and 100% so that I can act before the month ends.
**Rules:**
- A worker job runs daily at 14:00 UTC (and once at worker start-up, deduplicated) and computes the current month's spent vs Budget.
- For each threshold (80, 100) reached and not yet alerted this month, it records the alert (`budget_alerts`, unique month + threshold) and sends one email to every Staff Member through the outbox. If both are reached in the same check, it sends only the 100% email and records both.
- Email (Llyner Leads branding, Midnight email template): subject "Spend passed <80|100>% of the <Month> budget"; body: date, month-to-date spent, Budget, pct, the 3 biggest items so far (name and category, or category for automatic lines), a button "Open the P&L" to `/app/staff/expenses`, and the footer "You get this once per threshold (80% and 100%) each month because you are Staff on Llyner Leads."
- Raising the Budget later in the month doesn't re-send for thresholds already alerted.
- Fires `budget_alert_sent`.
**Errors / edge cases:** SMTP down → the outbox retries (existing behaviour); the alert stays recorded so it is not sent twice. No Staff Members → nothing sent, logged.
**Acceptance criteria:**
- Given Budget $300 and month-to-date spend $250, when the job runs, then an 80% email goes to every Staff Member and a second run that day sends nothing.
- Given spend jumps from $200 to $401.37 between runs, when the job runs, then only the 100% email is sent and both thresholds are recorded.
- Given spend of $100, then no email.

### FR-13: Audit and permissions
**Story:** As Staff, I want every change recorded so that the numbers can be trusted.
**Rules:** all writes in this PRD record an Audit log entry (`action`, `targetType` `expense`|`provider_invoice`|`budget`|`pnl`, `targetId`, details with before/after). All endpoints are `staff`. The nav item "Expenses" appears only for Staff, between "Credit packs" and "Settings".
**Acceptance criteria:**
- Given Staff change a bill's category, then the Audit log shows `expense.updated` with `{ category: { from: "other", to: "software_tools" } }`.
- Given a signed-in Owner, when they open `/app/staff/expenses`, then they see the not-found page and the API returns 403.

## 6a. Acceptance journeys
### AJ-1: Add a bill and see it in the P&L
**Persona:** Staff · **Covers:** FR-1, FR-2, FR-9, FR-13
1. Sign in as `staff@demo.test` (TOTP), open Back office → Expenses.
2. On the Expenses tab, click "Add expense", choose Recurring, enter "Figma", vendor "Figma", Software & tools, $15.00, Monthly, starting today.
3. Save; the bill appears in the list with next charge next month.
4. Open the P&L tab.
**Expected:** Software & tools increased by $15.00; total expenses, net and budget pct updated; the Audit log has `expense.created`.

### AJ-2: Change a price from a date
**Persona:** Staff · **Covers:** FR-3
1. On Expenses, open "Resend" and add a price change: $25.00 from the 18th of next month.
2. Save; the panel lists both versions.
3. Switch the month selector to next month (no Charge yet if before the 18th) and back to this month.
**Expected:** this month still shows Resend $20.00; the list shows the next charge at $25.00.

### AJ-3: Enter a provider invoice and catch a gap
**Persona:** Staff · **Covers:** FR-6, FR-8, FR-9
1. Open the Provider invoices tab for the current month.
2. Twilio shows source `estimate`; enter an invoice of $1.50 and save.
3. Twilio now shows source `invoice`, gap +66.7%, flagged, and the banner counts it.
4. Open the P&L tab.
**Expected:** Data providers include $1.50 for Twilio instead of the metered $0.90; gross profit is $0.60 lower.

### AJ-4: Budget alert email
**Persona:** Staff · **Covers:** FR-11, FR-12
1. On the P&L tab, set the Budget to an amount just below this month's spend.
2. Trigger the budget check (test-only endpoint `POST /api/test/jobs/budget-check`, enabled only when `NODE_ENV=test`).
3. Open Mailpit.
**Expected:** one "Spend passed 100% of the <Month> budget" email per Staff Member with the right figures; triggering again sends nothing new.

### AJ-5: Export the P&L
**Persona:** Staff · **Covers:** FR-10
1. On the P&L tab, click "Export CSV" (current month).
**Expected:** a file `llyner-leads-pnl-<month>-to-<month>.csv` downloads whose `net` row equals the net shown on screen.

### AJ-6: Not for customers; bad input (failure path)
**Persona:** Owner, then Staff · **Covers:** FR-4, FR-13
1. Sign in as `owner@demo.test`; the back office nav isn't there; visiting `/app/staff/expenses` shows not found.
2. Sign in as Staff; add a One-off dated tomorrow.
**Expected:** the form shows "Date can't be in the future" and nothing is saved.

## 6b. Screens
Mocks (Design artifact): [Llyner Leads Expenses](https://claude.ai/artifact/3W8Y6GFaySsrvnkc7diuC8), approved 2026-11-20. Workflow row: FlowBefore / Main (after). Screen rows (mobile and desktop, before and after): P&L (PnlMobileBefore, PnlDesktopBefore, PnlMobileAfter, PnlDesktopAfter); Expenses (ExpMobileBefore, ExpDesktopBefore, ExpMobileAfter, ExpDesktopAfter with the edit panel, ExpFormMobileAfter); Provider invoices (InvMobileBefore, InvDesktopBefore, InvMobileAfter, InvDesktopAfter); Email (EmailBudgetAlert).

The mocks label Google's provider "Google Places"; the build uses the catalog's provider name "Google Maps Platform".

| Screen | Route | Purpose | Empty / loading / error states |
|--------|-------|---------|--------------------------------|
| P&L tab | `/app/staff/expenses?tab=pnl&month=YYYY-MM` (default tab, default current month) | Month statement, budget bar and banner, 12-month chart (inline SVG bars: revenue vs expenses, net line), category breakdown, yearly bills, run-rate, Export CSV, Budget edit | Empty "Nothing recorded for <Month> yet."; skeleton rows while loading; error panel with Retry |
| Expenses tab | `?tab=expenses&month=` | List with filters, Add expense (drawer on desktop, full-screen form on mobile), edit panel with price versions, End, Delete | Empty state with Add button; inline field errors; 409 messages shown in the panel |
| Provider invoices tab | `?tab=invoices&month=` | Per-provider metered vs invoice or plan, inline invoice entry, gap flags and banner | "No provider usage in <Month>."; per-row save spinner and error |
| Budget alert email | — | FR-12 | — |

Month selector: from November 2026 to the current month. Mobile: tabs scroll horizontally, tables become cards (as InvMobileAfter), touch targets ≥ 44 px.

## 7. Interfaces
Conventions as in prd-first-version §7 (JSON, errors `{ error: { code, message, fields? } }`, 401/403, Origin check). All endpoints: auth `staff`. `Money = { cents: int, currency: "usd" }`. `Month = /^\d{4}-(0[1-9]|1[0-2])$/`, ≥ `2026-11`, ≤ current month unless stated; violations: 422 `BEFORE_HISTORY_START` / `FUTURE_MONTH`. `Category` = the ten keys in §6. `ProviderKey` = slug from FR-6.

Shared shapes:
- `Expense = { id, kind: "recurring"|"one_off", name, vendor, category: Category, amount: Money (current price, or the one-off amount), cadence: "monthly"|"yearly"|null, startsOn: date (one-off: spentOn), endsOn: date|null, nextChargeOn: date|null, status: "active"|"ending"|"ended", coversProvider: { key: ProviderKey, name } | null, link: string|null, notes: string|null, monthlyEquivalent: Money|null, versions: [{ effectiveFrom: date, amount: Money }] (recurring only, ascending), chargesInMonth: [{ date, amount: Money }], createdAt, updatedAt }`
- `ProviderRow = { provider: { key, name }, category: "ai"|"data_providers", metered: Money, invoice: { amount: Money, note: string|null, enteredAt, enteredBy: { id, email } } | null, plan: { expenseId, name, amount: Money } | null, counted: { source: "invoice"|"plan"|"estimate", amount: Money }, gapPct: number|null, planUsedPct: int|null, flagged: bool }`

### Expenses
- `GET /api/staff/finance/expenses?month&category&kind=recurring|one_off&includeEnded=bool`: 200 `{ month, items: Expense[], totals: { fixedRunRate: Money, chargesInMonth: Money } }` (no pagination; < 200 rows expected).
- `POST /api/staff/finance/expenses`: Req `{ kind: "recurring", name, vendor, category, amountCents, cadence, startsOn, endsOn?, coversProvider?: ProviderKey, link?, notes? }` or `{ kind: "one_off", name, vendor, category, amountCents, spentOn, link?, notes? }`. 201 `Expense`. Errors 400, 404 `UNKNOWN_PROVIDER`, 409 `PROVIDER_ALREADY_COVERED { expenseId, name }`, 422 `BEFORE_HISTORY_START`, 422 `COVERS_PROVIDER_CATEGORY` (category not ai/data_providers).
- `PATCH /api/staff/finance/expenses/:id`: Req any of `{ name, vendor, category, link, notes, coversProvider: ProviderKey|null, endsOn: date|null }` (recurring) or `{ name, vendor, category, amountCents, spentOn, link, notes }` (one-off). 200 `Expense`. Errors 400, 404, 409 `PROVIDER_ALREADY_COVERED`, 422 as above.
- `POST /api/staff/finance/expenses/:id/prices`: recurring only. Req `{ effectiveFrom: date, amountCents }`. 201 `Expense`. Errors 400, 404, 409 `NOT_RECURRING`, 422 `EFFECTIVE_BEFORE_START`.
- `DELETE /api/staff/finance/expenses/:id/prices/:effectiveFrom`: removes a version other than the first. 200 `Expense`. Errors 404, 409 `FIRST_VERSION`.
- `DELETE /api/staff/finance/expenses/:id`: 204. Errors 404, 409 `HAS_CHARGES`.
- `GET /api/staff/finance/providers`: 200 `{ items: [{ key, name, category }] }` (for the "covers usage of" picker).

### Provider invoices
- `GET /api/staff/finance/provider-invoices?month`: 200 `{ month, rows: ProviderRow[], totals: { metered: Money, counted: Money }, flaggedCount: int }`.
- `PUT /api/staff/finance/provider-invoices/:provider/:month`: Req `{ amountCents: int 0..10,000,000, note?: string ≤ 200 }`. 200 `ProviderRow`. Errors 400, 404 `UNKNOWN_PROVIDER`, 422 month rules.
- `DELETE /api/staff/finance/provider-invoices/:provider/:month`: 200 `ProviderRow` (reverted). Errors 404 `NO_INVOICE`.

### P&L and Budget
- `GET /api/staff/finance/pnl?month`: 200 `{ month, monthToDate: bool, revenue: { sales: Money, salesCount: int, refunds: Money, net: Money }, costOfRevenue: { lines: [{ category, label, amount: Money, source: "providers"|"stripe_fees"|"bills" }], total: Money }, grossProfit: Money, grossMarginPct: number|null, operating: { lines: [{ category, amount: Money }], total: Money }, netProfit: Money, totalExpenses: Money, categories: [{ category, amount: Money, sharePct: number }], yearlyThisMonth: [{ expenseId, name, amount: Money, monthlyEquivalent: Money }], fixedRunRate: Money, budget: { amount: Money, spent: Money, pct: int|null, status: "under"|"near"|"over", alertsSent: [80|100] }, providerFlags: int, trend: [{ month, revenue: Money|null, expenses: Money|null, net: Money|null }] (12, oldest first) }`.
- `GET /api/staff/finance/pnl.csv?from&to`: 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="llyner-leads-pnl-<from>-to-<to>.csv"`. Errors 400 (`from` > `to`, > 24 months), 422 month rules.
- `GET /api/staff/finance/budget`: 200 `{ monthlyBudget: Money, updatedAt, updatedBy: { id, email } | null }`.
- `PUT /api/staff/finance/budget`: Req `{ monthlyBudgetCents: int 0..10,000,000 }`. 200 as GET. Errors 400.
- `POST /api/test/jobs/budget-check`: only registered when `NODE_ENV=test`; 200 `{ sent: [80|100] }`.

### Billing (changed)
- `POST /api/webhooks/stripe` additionally handles `charge.refunded` (FR-7). `checkout.session.completed` / `async_payment_succeeded` now also store `payment_intent`.

### Module ports (public functions, not HTTP)
- billing → finance: `revenueForMonth(month) → { sales: [{ purchaseId, amountCents, taxCents, paidAt }], refunds: [{ purchaseId, refundedNetCents, refundedAt }] }`.
- tools → finance: `meteredCostByProvider(month) → [{ provider: name, micros: bigint }]` and `providers() → [{ name, toolKeys }]`.
- identity → finance: `staffRecipients() → [{ memberId, email, name }]`.
- platform → finance: existing `AuditLog`, `AnalyticsTracker`, `EmailSender` (outbox).

### External integrations
| Service | Purpose | Auth | When it's down |
|---------|---------|------|----------------|
| Stripe | `charge.refunded` webhook (existing endpoint and secret) | webhook secret | Stripe retries; refunds appear when delivered |
| SMTP provider | budget alert emails | existing settings | outbox retries 5×; alert stays recorded |

## 8. Data model
| Entity | Fields (type, constraints) | Relationships | Context |
|--------|----------------------------|---------------|---------|
| expenses | id uuid PK, kind enum(recurring, one_off), name varchar(80), vendor varchar(80), category enum(10 keys), cadence enum(monthly, yearly) null, starts_on date (one-off: spent on), ends_on date null, covers_provider varchar(64) null (provider name), link varchar(2048) null, notes varchar(500) null, created_by_member_id, created_at, updated_at, deleted_at null; index (kind, deleted_at), (covers_provider) | 1–n expense_prices | finance |
| expense_prices | id uuid PK, expense_id FK, effective_from date, amount_cents int; unique (expense_id, effective_from) | one-offs have exactly one row (effective_from = starts_on) | finance |
| provider_invoices | provider varchar(64), month char(7), amount_cents int, note varchar(200) null, entered_by_member_id, entered_at, updated_at; PK (provider, month) | | finance |
| finance_budgets | month char(7) PK, budget_cents int, set_at (snapshot per month, written when the month is first read or alerted, and on change for the current month) | | finance |
| finance_settings | id tinyint PK (=1), monthly_budget_cents int default 30000, updated_by_member_id null, updated_at | | finance |
| budget_alerts | month char(7), threshold tinyint (80, 100), spent_cents int, budget_cents int, sent_at; PK (month, threshold) | | finance |
| purchases (changed) | + stripe_payment_intent_id varchar(255) null unique, + refunded_cents int default 0, + refunded_at datetime null | | billing |

Volume: < 200 expenses, < 20 providers × months. Retention: kept forever. Migration: none of the existing data changes; `stripe_payment_intent_id` is null for purchases made before the release (their refunds can't be matched and are logged, which is acceptable at today's volume).

### 8a. Demo seed data
Seeded for November 2026 (dates relative to the seed's "today" are not used; the seed is fixed to 2026-11 so the P&L matches the mocks), added to the existing seed:
- Recurring: "DigitalOcean App Platform" Hosting $42.15 monthly from 2026-11-05; "Resend" Email $20.00 monthly from 2026-11-18; "llyner.com" Domain & DNS $14.99 yearly from 2026-11-02; "1Password" Software & tools $7.00 monthly from 2026-11-09; "Apify Starter" Data providers $49.00 monthly from 2026-11-03 covering Apify; "Firecrawl Hobby" Data providers $16.00 monthly from 2026-11-04 covering Firecrawl.
- One-off: "Terms and privacy review" Legal & admin $300.00 on 2026-11-12.
- Tool calls in November with provider cost: Anthropic $38.40, Google Maps Platform $12.75, ZeroBounce $4.80, Twilio $0.90, Apify $22.10, Firecrawl $3.20.
- Provider invoices for 2026-11: Anthropic $44.10, Google Maps Platform $17.20, ZeroBounce $4.80.
- Paid purchases in November: $49.00, $49.00, $99.00 (Sweet Supply Co, Corner Coffee Roasters, Sweet Supply Co).
- Budget $300.00; `budget_alerts` for 2026-11: 80 and 100 recorded on 2026-11-12.
Expected November P&L: the figures in FR-9's first criterion.

## 9. Technical notes
- New bounded context **finance** (ADR 0020): `apps/api/src/modules/finance`, web feature `apps/web/src/features/finance` mounted inside the back office layout.
- Charges, metered costs and the P&L are computed on read from bills, price versions, Purchases and Tool calls (no materialised ledger); one month is a handful of aggregate queries. A pure domain function `buildPnl(inputs)` does all arithmetic in integer cents, so it is unit-tested exhaustively without a database.
- Rounding: half up at each conversion (micros → cents per provider-month, fee per sale, monthly equivalent per bill), then sums.
- Worker: a `finance` BullMQ queue with a job scheduler `budget-check` (pattern `0 14 * * *`, UTC), registered in `worker-registry.ts` by the orchestrator.
- Chart: inline SVG component in the feature (no chart dependency), following the dataviz palette in DESIGN.md tokens; values also shown in a table for screen readers.
- No new npm dependencies.

## 10. Non-functional requirements
- NFR-1: Performance: `GET /api/staff/finance/pnl` p95 < 300 ms with 12 months, 200 expenses and 500,000 Tool calls (index `(tool_key, created_at)` already exists).
- NFR-2: Security: every endpoint requires `staff` with two-factor passed; Acting as doesn't widen or narrow it; links are rendered `rel="noopener noreferrer"` and must be `https:`; amounts validated server-side.
- NFR-3: Accessibility: WCAG 2.1 AA; the chart has a text alternative (the data table); status is never shown by colour alone (flag rows also carry the word "Gap" and a warning icon label).
- NFR-4: Correctness: the P&L for a month is identical between two reads with no data change, and the CSV totals equal the screen to the cent.

## 11. Testing notes
- `buildPnl` table-driven unit tests covering every FR-9 rule, the single-source rule, charge date clamping (31st, Feb, leap year), yearly anniversaries, price versions, refunds, rounding.
- Integration tests against MySQL for the month aggregates (UTC boundaries) and the budget alert uniqueness under two concurrent job runs.
- A fixed clock (`2026-11-20T12:00:00Z`) in API tests; Playwright uses the seed plus the test-only budget-check endpoint.

## 12. Release notes
- Migrations: finance tables; `purchases` columns. Pre-deploy migration job (existing).
- Stripe: add `charge.refunded` to the webhook endpoint's events in the Stripe dashboard (founder; one-time).
- No new settings or secrets. The worker picks up the `finance` queue on deploy.
- After deploy, the founder enters the real November bills and invoices (the seed is dev-only).

## 13. Assumptions & decisions
- Staff only; all Staff receive budget emails: one operator today.
- Cash basis; yearly bills hit the month paid, with a monthly-equivalent figure for context.
- Single-source rule (invoice > linked plan > metered) so usage is never counted twice; gap flag at 15%.
- Stripe fees estimated at 2.9% + 30¢ on the charged total (incl. tax) per sale; exact fees later.
- Revenue excludes tax; refunds net of tax reduce revenue in the refund month; credits aren't clawed back automatically.
- Ten fixed categories; Anthropic → AI, all other providers → Data providers.
- Months are UTC calendar months; history starts 2026-11-01.
- Charges are derived on read rather than stored; deleting is blocked once a bill has charged (end it instead).
- Budget counts everything, including One-offs; both thresholds crossed at once → one 100% email.
- Budget alerts at 14:00 UTC (morning in the US).
- New `finance` context rather than extending `reporting` (which is read-only) or `billing` (customer credits).

## 14. Risks & open questions
- [ ] Purchases paid before release have no payment intent, so their refunds can't be matched: founder, not blocking (logged; handle by hand).
- [ ] Should the Staff dashboard's gross margin switch to the invoice-adjusted figure? Founder, not blocking (Later).
- [ ] Is 14:00 UTC the right alert time? Founder, not blocking.

## 15. Change log
| Version | Date | Change |
|---------|------|--------|
| 0.1 | 2026-11-20 | Initial draft from the approved Expenses canvas |

## 16. Execution plan
| Wave | Package | Title | Model | Depends on | FRs / AJs |
|------|---------|-------|-------|------------|-----------|
| W0 | WP-0 | Contracts, migrations, table types, finance skeletons, seed | opus | — | all |
| W1 | WP-1 | finance module: expenses, prices, charges, provider invoices, P&L, CSV, budget | opus | WP-0 | FR-1–6, 8–11, 13 |
| W1 | WP-2 | billing refunds + revenue query; tools metered-cost query; identity staff recipients | sonnet | WP-0 | FR-5, 6, 7 |
| W1 | WP-3 | web finance feature: P&L, Expenses, Provider invoices tabs | sonnet | WP-0 | FR-1–4, 8–11, 13 |
| W2 | WP-4 | budget alert job and email | sonnet | WP-1, WP-2 | FR-12 |
| W2 | WP-5 | Playwright specs AJ-1 to AJ-6 | sonnet | WP-1, WP-2, WP-3 | AJ-1–6 |
| W2 | WP-R | hardening and review | opus | WP-4, WP-5 | all |

| Wave | Demo: what you can see or try | Journeys unlocked |
|------|-------------------------------|-------------------|
| W0 | Migrations run; `./dev seed` loads the November bills, invoices and purchases; contracts compile | — |
| W1 | Back office → Expenses: the November P&L matches the mock ($197.00 / $522.75 / −$325.75); add and edit bills, change a price, enter invoices and see the Google gap flagged; export CSV; a fake Stripe refund lowers revenue | — |
| W2 | Budget alert email in Mailpit; every journey walked by hand and by Playwright; review findings fixed | AJ-1–6 |

```yaml
execution:
  orchestrator_model: opus
  waves:
    - id: W0
      name: Foundation
      parallel: false
      demo: "Migrations run; ./dev seed loads the November finance data; contracts compile"
      journeys: []
      packages:
        - id: WP-0
          title: Contracts, migrations, table types, finance skeletons, seed
          model: opus
          requirements: all
          owns: ["packages/contracts/src/finance.ts", "packages/contracts/src/finance.test.ts", "packages/contracts/src/index.ts", "apps/api/migrations/*_finance_*", "apps/api/migrations/*_billing_refunds*", "apps/api/src/modules/finance/index.ts", "apps/api/src/modules/finance/infrastructure/tables.ts", "apps/api/src/modules/billing/infrastructure/tables.ts", "apps/api/src/shared/infrastructure/db/schema.ts", "apps/web/src/features/finance/index.ts", "apps/api/src/scripts/seed*.ts"]
          dependencies: []
          depends_on: []
          done_when: ["a contract exists for every §7 endpoint with request, response and error schemas", "migrations create every §8 table and the purchases columns", "seed produces the §8a data", "./dev test green"]
    - id: W1
      name: Expenses and P&L
      parallel: true
      demo: "November P&L matches the mock; bills, price changes, invoices with the gap flag, CSV export, refunds"
      journeys: []
      packages:
        - id: WP-1
          title: finance module
          model: opus
          requirements: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-8, FR-9, FR-10, FR-11, FR-13]
          owns: ["apps/api/src/modules/finance/**"]
          depends_on: [WP-0]
          done_when: ["buildPnl unit tests cover every FR-9 rule and the single-source rule", "HTTP tests per endpoint incl. 403 for non-Staff", "November seed P&L equals FR-9's figures", "Audit log entries asserted for every write"]
        - id: WP-2
          title: billing refunds and revenue query, tools metered cost, identity staff recipients
          model: sonnet
          requirements: [FR-5, FR-6, FR-7]
          owns: ["apps/api/src/modules/billing/**", "apps/api/src/modules/tools/**", "apps/api/src/modules/identity/**"]
          depends_on: [WP-0]
          done_when: ["charge.refunded idempotency test", "payment intent stored on paid", "revenueForMonth and meteredCostByProvider integration tests with UTC month edges", "staffRecipients tested"]
        - id: WP-3
          title: web finance feature
          model: sonnet
          requirements: [FR-1, FR-2, FR-3, FR-4, FR-8, FR-9, FR-10, FR-11, FR-13]
          owns: ["apps/web/src/features/finance/**", "apps/web/src/shared/i18n/**"]
          depends_on: [WP-0]
          done_when: ["three tabs match the approved after-boards on mobile and desktop", "pages and forms tested with Testing Library and MSW handlers that parse the contracts", "empty, loading and error states tested"]
    - id: W2
      name: Alerts, journeys and hardening
      parallel: false
      demo: "Budget alert email in Mailpit; every AJ passes in Playwright; review findings fixed"
      journeys: [AJ-1, AJ-2, AJ-3, AJ-4, AJ-5, AJ-6]
      packages:
        - id: WP-4
          title: budget alert job and email
          model: sonnet
          requirements: [FR-12]
          owns: ["apps/api/src/modules/finance/**"]
          depends_on: [WP-1, WP-2]
          done_when: ["once-per-threshold test incl. concurrent runs", "both-thresholds case sends one email", "email renders in Mailpit in an integration test"]
        - id: WP-5
          title: Playwright specs AJ-1 to AJ-6
          model: sonnet
          owns: ["e2e/aj-expenses-*.spec.ts"]
          depends_on: [WP-1, WP-2, WP-3, WP-4]
          done_when: ["each AJ has a passing spec"]
        - id: WP-R
          title: Hardening and review
          model: opus
          owns: []
          depends_on: [WP-5]
          done_when: ["security checklist passes", "NFR-1 measured", "every FR and AJ maps to a passing test"]
```

The orchestrator wires the finance module into `app.ts`/`composition.ts`, the `finance` queue into `worker-registry.ts`, the route and the "Expenses" item into `apps/web/src/app/**` (`staffNav`, between Credit packs and Settings), and the test-only job endpoint.

## 17. Implementation notes
_Filled in by /build-requirement: FR → test files, AJ → Playwright specs, sign-off per wave, decisions on gaps._
