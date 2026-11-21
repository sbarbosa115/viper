# Glossary (ubiquitous language)

Use these exact terms in code, UI, tests and PRDs.

| Term | Meaning | Context | Avoid saying |
|------|---------|---------|--------------|
| Business | A Viper customer account (the tenant). Everything a customer owns belongs to one Business | identity | workspace, company, tenant (in UI) |
| Member | A person who can sign in to a Business | identity | user (in UI), seat |
| Owner | The Member who created the Business; can manage Members and buy credits | identity | admin |
| Staff | A Viper operator who can open the back office (signs in with two-factor) | identity | admin, superuser, super admin |
| Two-factor lock | An hour in which a Staff Member can't pass two-factor, after 10 wrong codes within an hour | identity | lockout, ban |
| Acting as | Staff using a Business's account as its Owner would see it, for support | identity | impersonate, assume, log in as |
| Business Profile | What we know about a Business: what it sells, location, delivery area, current customers, price range | profile | settings, company info |
| Product | Something the Business sells, as listed in its Business Profile (e.g. "cane sugar, 50 lb bag") | profile | item, SKU |
| Conversation | A chat between a Member and the Viper assistant (welcome chat, planning) | assistant | thread, session |
| Goal | What the Business wants, in its own words ("new customers within 3 miles for our sugar") | planning | objective, campaign |
| Plan | A Goal turned into a concrete research job: target segments, search area, research flow, budget | planning | campaign, search (as a noun) |
| Ideal Customer Profile | The kinds of businesses that should buy, with fit signals and exclusions | planning | ICP (in UI), persona |
| Target segment | One kind of buyer in the Ideal Customer Profile ("bakeries"), with its fit signals and the Product to pitch | planning | category |
| Fit signal | Something observable that makes a prospect a better fit ("bakes on site") | planning | criterion |
| Search area | Where to look: a centre point and a radius | planning | region |
| Research flow | The recipe the agent follows: ordered, resumable Steps, each with a goal, allowed Tools and limits | research | workflow, pipeline, playbook |
| Flow template | A Research flow provided by Viper for a market (the default is "Local buyers") | research | preset |
| Step | One stage of a Research flow ("Maps & places") | research | stage, task |
| Research run | One execution of a Plan's Research flow by the agent | research | job, search, scan |
| Checkpoint | Saved progress after a Step, so a run can resume | research | snapshot |
| Step progress | Work done and left inside a Step, saved after every Tool call so a retry continues mid-Step | research | cursor, pipeline state |
| Guardrails | Limits on a run: max credits, max time, minimum fit score (set by the Research flow, lowered by a Plan) | research | limits, caps |
| Attempt | One execution of a Research run; a retry is a new attempt that resumes from the handoff | research | retry (as a noun), try |
| Handoff | What one attempt leaves for the next: step, items done and left, the agent's notes, last error, credits and time left | research | context, state dump |
| Flow settings | A Research flow's limits, retry policy, plan defaults and per-step budgets, versioned with the flow | research | config |
| Platform ceilings | The highest values any flow or plan may use, set by Staff in Settings | platform | run limits |
| Tool | A capability the agent can call (places search, maps scraper, website reader, email verify…) | tools | integration, connector, actor |
| Tool call | One metered use of a Tool during a run | tools | request, hit |
| Rate card | The price in credits of one unit of each Tool | tools | price list |
| Prospect | A business found during a run, before it is qualified | leads | result, record |
| Lead | A Prospect that passed the filters and is delivered to the Business | leads | contact, prospect (once delivered) |
| Contact | A way to reach a Lead: a person, phone, email, website or social profile | leads | info |
| Source | Where a fact came from (website, Google Maps, Yelp…) and when | leads | origin |
| Verified | A Contact detail that passed a check (email accepts mail, phone is valid) | leads | confirmed, valid |
| Fit score | 0–100 rating of how well a Lead matches the Ideal Customer Profile | leads | rating, rank |
| Evidence | The facts, each with a Source and points, that add up to a Fit score | leads | reasons |
| Pitch | Which Product to offer a Lead and why | leads | script |
| Lead list | The Leads delivered by one Plan's runs | leads | results, export |
| Feedback | A Member marking a Lead "Good lead" or "Not a fit" | leads | rating |
| Removal list | Businesses that asked not to be included; never delivered again (later; not in the first version) | leads | blocklist, suppression list |
| Credit | Viper's unit of spend; one credit is a fixed amount of provider cost plus margin | billing | token, point |
| Credit wallet | A Business's credit balance and its ledger | billing | account, bag |
| Credit pack | A one-time purchase that adds credits | billing | plan, subscription |
| Reservation | Credits held for a running Research run, settled when it ends | billing | hold |
| Settlement | Charging a run's real cost and releasing the rest of its Reservation | billing | |
| Waived cost | Spend a failed run with 0 Leads isn't charged for; it stays waived if the run is resumed, so only work after the resume can be charged | billing / research | refund, credit back |
| Ledger entry | One immutable movement of credits (grant, purchase, reservation, settlement, adjustment) | billing | transaction |
| Platform settings | Staff-managed configuration: provider and model keys, SMTP, Stripe, analytics, run limits; secrets encrypted | platform | config, env |
| Audit log | Append-only record of Staff access and changes, including everything done while Acting as | platform | history, activity |
| Cost per lead | Credits spent on a run divided by the Leads it delivered | billing / leads | CPL (in UI) |
| Expense | Anything Llyner Leads pays for, as a Recurring bill or a One-off expense, in one of ten fixed categories | finance | cost (in UI), spend item |
| Recurring bill | An Expense charged monthly or yearly from a start date, with price versions effective from a date; it may cover a provider's usage | finance | subscription, recurring expense |
| One-off expense | An Expense paid once, counted in the month of its date | finance | ad-hoc cost |
| Charge | One due date of a Recurring bill and the price in effect then; derived, not stored | finance | payment, instance |
| Provider invoice | What a provider actually billed for a month, entered by Staff; it replaces the metered estimate and any plan for that provider and month | finance | bill (for providers) |
| Metered estimate | A provider's month of Tool-call provider cost, used when there's no invoice or plan | finance | usage cost |
| Gap | How far a Provider invoice differs from the metered estimate, in %; flagged above 15% | finance | variance |
| P&L | The monthly statement: revenue, cost of revenue, gross profit, operating expenses, net profit (cash basis, UTC months) | finance | report, income statement (in UI) |
| Cost of revenue | Provider costs and Stripe fees (categories AI, Data providers, Payments fees) | finance | COGS (in UI) |
| Fixed run-rate | Monthly total of active Recurring bills, yearly ones divided by 12 | finance | burn |
| Budget | The platform-wide monthly spending limit (default $300); all Staff are emailed at 80% and 100% | finance | cap, limit |
