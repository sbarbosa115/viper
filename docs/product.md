# Llyner Leads (code name: Viper)

_Last updated: 2026-11-21_

## Vision
Viper finds the businesses most likely to buy what you sell, with verified contact details and the reason each one is a fit, so any small business can grow without a sales team.

## Problem
Small businesses and solo sellers have a good product or service but get lost trying to find new customers. Finding prospects by hand means hours on Google Maps, directories and social media, copying details into a spreadsheet, and guessing who is worth calling. Lead databases (Apollo, ZoomInfo) are built for enterprise sales teams, priced per seat, weak on small local businesses, and give no reason why a prospect fits. Agencies are too expensive.

## Personas
### Sam, owner of a small B2B supplier (primary)
- Example: a sugar and baking-ingredients distributor in Austin selling to bakeries and cafés.
- Goal: a steady list of nearby businesses to call each week.
- Pain: no time or skill for prospecting; buys leads that turn out to be wrong or dead.
- Usage: weekly, runs a plan and works through the list.

### Maria, solo service provider
- Example: a commercial cleaner, bookkeeper or caterer selling to local businesses.
- Goal: find businesses that need the service, and know what to say.
- Pain: doesn't know who to target beyond referrals.
- Usage: a few times a month.

### A team member (assistant or sales rep)
- Works the lead list the owner's plans produce: calls, marks contacted, gives feedback.
- Usage: daily while a list is active.

### Staff (Viper operator, initially the founder)
- Manages the tool catalog and rate card, credit packs, flow templates, customers, and watches agent runs.
- The founder is also customer #1 and uses Viper to sell Viper.

## Value proposition
Describe what you sell in a short chat, and Viper's research agent returns verified local buyers with evidence and a pitch, at a known cost per lead.

## Business model
- Revenue: prepaid **credit packs** (one-time Stripe purchases, no subscription). Every research run is charged its real cost (AI, scraping, enrichment, verification) at rate-card prices that include our margin. Pricing: `[TBD]` per pack.
- Free trial: 50 credits on email verification so a new business sees a few of its own leads before paying. Credits never expire and are not refundable.
- Acquisition: founder-led content and outreach, using Viper on itself; SEO on the public site.
- Competitors:
  - Apollo, ZoomInfo, Seamless: big B2B databases; enterprise-focused, per-seat, weak on local SMBs, no "why this fits".
  - Outscraper, Apify actors, PhantomBuster: raw scraping; the user must do the research, cleaning and verification themselves.
  - Local lead lists and freelancers: one-off, unverified, no reasoning.
  - **Viper differs** by doing the whole research job (find, read, verify, rank) for a goal, explaining each lead with evidence, and charging per research run instead of per seat.

## Riskiest assumptions
| # | Assumption | Cheapest test | Status |
|---|------------|---------------|--------|
| A-1 | From public sources we can deliver relevant, contactable leads: ≥ 70% of delivered leads rated a good fit, and ≥ 85% of delivered emails/phones valid | Founder runs 5 plans in 2 markets and rates every lead; track verification bounce rates | Open |
| A-2 | Provider cost per qualified lead is low enough to sell at ≥ 60% gross margin at prices SMBs accept | Meter every tool call in the first 20 runs and compute provider cost per lead | Open |
| A-3 | The welcome chat captures enough about a business to produce a good plan without manual editing (≥ 70% of plans started without edits to the ideal customer profile) | Track plan edits in the first version | Open |
| A-4 | A background agent run finishes reliably within budget and 60 minutes (≥ 95% of runs) | Run metrics in the staff back office | Open |
| A-5 | Small businesses will pay for credit packs after the trial (≥ 10% trial-to-paid) | First 20 outside sign-ups | Open |

## Product principles
1. **Results first:** a short list of great leads beats a long list of maybes. When in doubt, filter harder.
2. **Show the evidence:** every score, contact and cost can be traced to a source. Never ask users to trust a black box.
3. **Calm while the agent works:** users set a goal and come back to results; no live logs.
4. **Money is always visible:** show the estimate before spending credits and the real cost after.
5. **Public business data only:** never consumers, never logged-in scraping, honour removal requests (by hand until a Removal list ships).

## Success metrics
- North star: **good leads per active business per week** (leads marked "Good lead" or "Contacted"). Target: `[TBD]` after the first 5 founder runs set a baseline.
- Supporting: cost per qualified lead (provider $ and credits), run success rate (A-4), trial-to-paid conversion (A-5), gross margin per credit (A-2).

## Roadmap
| Item | Tests assumption | Status | PRD |
|------|------------------|--------|-----|
| First version: public landing page (SEO, video, pricing, sign-up/log-in card); sign up, welcome chat → Business Profile → Plan → default "Local buyers" research flow run by a background agent that resumes across attempts → lead list, lead detail, CSV export; credit wallet with 50 trial credits and Stripe packs; Staff back office (dashboard, customers, Acting as, runs, research flow settings, tools and rate card, platform settings, audit log); legal pages | A-1, A-2, A-3, A-4, A-5 | Built (v0.3, 2026-11-20) | [prd-first-version](prd-first-version.md) |
| Expenses and P&L (Staff): recurring bills, one-offs, metered usage and Stripe fees, provider invoices with gap flags, monthly cash P&L, budget alerts | A-2 | Shipped (2026-11-21) | [prd-expenses](prd-expenses.md) |
| Support tickets: Help in the app (open, follow, close tickets; Report a problem on runs and lead lists), Staff Support desk with waiting queue, take/assign, replies, internal notes, emails both ways | A-5, A-1 (supports) | Specced | [prd-support](prd-support.md) |
| Research flows: market templates and the flow editor | A-1 (other markets) | Idea | — |
| Team members and invites | A-5 | Idea | — |
| CRM sync (HubSpot) and outreach sequences | — | Later | — |
| Spanish | — | Later | — |

## Non-goals
- Finding or selling data about consumers (B2B only).
- Sending outreach (email, SMS, DMs) on the customer's behalf in the first version.
- Scraping content behind a login, or scraping LinkedIn directly.
- Being a general CRM.

## Constraints
- **Team:** the founder plus Claude.
- **Budget:** ~$150–300/month for hosting, AI and data providers while the founder is the only customer.
- **Launch date:** Monday 2026-11-23 (first version).
- **Markets:** US only. **Language:** English at launch, with UI text kept in one place so Spanish can be added later.
- **Compliance:** US B2B. Guide customers on CAN-SPAM (cold email needs an opt-out) and TCPA (no auto-dialled calls or texts to mobiles). GDPR applies if we expand to the EU. Data collection follows ADR 0007 (public data, provenance, removal list).
- **Name:** the public product name is **Llyner Leads**; **Viper** is the code name (repo, code, internal docs). All customer-facing text, emails and the browser title say "Llyner Leads". Domain `[TBD]`.
- **Hosting:** see docs/architecture/stack.md. **Design:** see DESIGN.md.
