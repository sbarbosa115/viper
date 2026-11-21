# 0020. A finance context with a cash-basis P&L and one cost source per provider

- Status: Accepted
- Date: 2026-11-20

## Context
Staff need to track what Llyner Leads costs to run (bills, provider usage, Stripe fees) against revenue, with a monthly budget (prd-expenses). Reporting is read-only and billing owns customer credits, so neither is a good home for Staff-entered expense data. Provider usage is visible in three overlapping forms: metered Tool calls at Rate card prices, flat plans (Apify, Firecrawl) and the providers' real invoices. Adding them up would count the same usage two or three times.

## Decision
- A new bounded context **finance** (`modules/finance`, `features/finance`) owns Expenses, price versions, Provider invoices, the Budget and budget alerts. It reads billing, tools and identity only through public query functions; nothing depends on it.
- The P&L is **cash basis** in UTC calendar months, computed on read: Recurring bill Charges are derived from start date, cadence and price versions rather than stored.
- **One cost source per provider and month:** the Provider invoice if entered, else the Recurring bill that covers the provider, else the metered estimate. A gap over 15% between invoice and metered is flagged.
- Stripe fees are estimated per sale (2.9% + 30¢) until exact fees are pulled from Stripe.

## Alternatives considered
- Extending reporting: it would stop being read-only and gain write rules.
- Storing Charges in a ledger table: needs a job and a backfill when a price version changes; derived Charges stay correct by construction at our volume.
- Accrual accounting: more accurate for yearly bills but heavier than a solo operator needs; the P&L shows monthly equivalents instead.

## Consequences
Price changes never rewrite past months. Entering an invoice changes a closed month's P&L, which is intended. If volume grows a lot, month aggregates may need caching.
