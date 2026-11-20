# PRD: First version of Llyner Leads

| Field   | Value |
|---------|-------|
| Status  | Built |
| Version | 0.4 |
| Date    | 2026-11-20 |
| Persona | Sam (small B2B supplier owner), Staff (the founder) |
| Tests assumption | A-1 lead accuracy, A-2 cost per lead, A-3 chat → good plan, A-4 run reliability |

Product name in all customer-facing text: **Llyner Leads**. Code name: Viper.

## 1. Overview
The smallest complete version of the product. A business owner signs up, describes the business in a short chat, and turns a goal ("new customers within 3 miles for our sugar") into a Plan. A background research agent then runs the default "Local buyers" Research flow and delivers a Lead list with verified contacts, a Fit score with Evidence, and a Pitch. Each run is paid for with credits: 50 free on sign-up, then Stripe Credit packs. The founder runs the business through a Staff back office with a dashboard, customer list, Acting as, runs, Tools and Rate card, Platform settings (keys, SMTP, Google Analytics), and an Audit log. A public landing page at `/`, rendered on the server for search engines, explains the product, shows the video and live prices, and holds the sign-up and log-in card; the app lives at `/app`. Research runs survive failures: each retry is a new attempt that resumes from a saved handoff, within limits set on the Research flow. The founder is customer #1 and uses this version to test whether the leads are good and cheap enough to sell.

## 2. Problem
Sam finds new customers by hand: hours on Google Maps, Yelp and Instagram, copying names and numbers into a spreadsheet, then guessing who is worth a call. Half the numbers are wrong and there's no record of why a business looked like a fit. Lead databases target enterprise sales teams, charge per seat and barely cover small local businesses.

## 3. Goals & success metrics
- G-1: Leads are relevant (A-1). Metric: ≥ 70% of delivered Leads marked "Good lead" across the founder's first 5 runs in 2 markets.
- G-2: Contacts work (A-1). Metric: ≥ 85% of delivered emails and phones Verified, measured by ZeroBounce and Twilio Lookup results plus founder call outcomes.
- G-3: Cost is known and sellable (A-2). Metric: provider cost per Lead recorded for 100% of runs; gross margin per credit ≥ 60% at Rate card prices.
- G-4: The chat produces a usable plan (A-3). Metric: ≥ 70% of runs started from a Plan whose Ideal Customer Profile was not edited.
- G-5: Runs finish (A-4). Metric: ≥ 95% of runs finish (completed, not failed) within 60 minutes and their credit budget.

### Non-goals
- Team members and invites, the customer flow editor and market templates (Staff can edit the default flow's settings, FR-37), CRM sync, outreach sequences, Spanish.
- TikTok, chambers of commerce and city directories as sources.
- Self-service account deletion or data export (Staff do it on request).
- The Removal list (deferred: Llyner Leads only provides public business data to the customer and sends no messages; if a removal request arrives, Staff handle it by hand).
- Google sign-in.

## 3a. Measurement
Server events go to `analytics_events` through the `AnalyticsTracker` port. Google Analytics (if a measurement ID is set) records page views only. No personal data goes into event properties.

| Event | When it fires | Properties | Proves |
|-------|---------------|------------|--------|
| `business_signed_up` | FR-1 succeeds | business_id, source (`landing`/`app`) | funnel |
| `email_verified` | FR-2 succeeds | business_id | funnel |
| `profile_completed` | Business Profile first reaches complete (FR-14/15) | business_id, via (`chat`/`manual`), messages_count | G-4 |
| `plan_created` | FR-16 | business_id, plan_id, segments_count, radius_miles | G-4 |
| `plan_icp_edited` | first ICP edit on a Plan (FR-17) | business_id, plan_id, field (`segments`/`fit_signals`/`exclusions`/`product`) | G-4 |
| `run_started` | FR-18 | business_id, plan_id, run_id, credits_reserved, started_by_staff | G-5 |
| `run_finished` | run reaches `completed`, `failed` or `cancelled` | run_id, status, duration_s, credits_spent, provider_cost_micros, leads_delivered, budget_reached, time_reached, icp_edited | G-3, G-4, G-5 |
| `lead_feedback_given` | FR-27 | lead_id, run_id, value (`good`/`not_fit`), fit_score | G-1 |
| `lead_contact_verified` | each contact verification result (FR-25) | run_id, type (`email`/`phone`), result (`verified`/`invalid`/`unknown`) | G-2 |
| `leads_exported` | FR-28 | plan_id, leads_count | engagement |
| `credit_pack_purchased` | FR-12 webhook fulfils | business_id, pack_id, credits, amount_cents | A-5 (later) |
| `run_attempt_finished` | an attempt ends (FR-36) | run_id, attempt, outcome (`completed`/`retryable_error`/`final_error`/`worker_stopped`), step_key, active_s | G-5 |
| `acting_as_started` | FR-6 | staff_member_id, business_id | audit |

## 4. Users & permissions
| Role | Can | Cannot |
|------|-----|--------|
| Visitor | Sign up, log in, reset password, read the Terms and Privacy pages | Anything else |
| Owner (unverified email) | Log in, use the welcome chat, edit the Business Profile, edit existing Plans, see the Credit wallet | Create a Plan, start a run or buy credits until the email is verified (no trial credits yet) |
| Owner | Everything for their own Business: chat, profile, Plans, runs, leads, feedback, CSV, buy Credit packs, change own password | See other Businesses; open the back office |
| Staff | Everything an Owner can do for their own Business, plus the back office: dashboard, customer list, Acting as, runs (and resume), Tools and Rate card, Credit packs, credit grants, Platform settings, Audit log | Use the back office without two-factor sign-in; become Staff through the UI |
| Staff Acting as a Business | See and do everything that Business's Owner can, as if signed in with their credentials. Runs started are charged to that Business and marked "started by Staff" | Change that Owner's email or password, buy credits, delete the Business; Act as two Businesses at once |

Staff status is granted only with a server command (`staff:grant <email>`: locally `./dev npm run staff:grant -w apps/api -- <email>`, in production from the App Platform console of the api component). Every Staff write while Acting as, and every back-office change, goes to the Audit log.

## 5. Scope
### Cut line (smallest shippable version)
- Sign up, verify email, log in and out, reset password (FR-1 to FR-4).
- Staff two-factor sign-in, Acting as, Audit log, Platform settings, Google Analytics (FR-5 to FR-9).
- Credit wallet, trial credits, Stripe Credit packs, Staff grants and packs (FR-10 to FR-13).
- Welcome chat → Business Profile, manual profile edit (FR-14, FR-15).
- Goal → Plan with editable ICP, search area and guardrails, plus estimate (FR-16, FR-17).
- Research run with the default "Local buyers" flow, guardrails, settlement, working screen, cancel and emails (FR-18 to FR-22).
- Tool catalog, Rate card, metering and provider adapters (FR-23, FR-24).
- Qualification, Lead list and detail, Feedback, CSV export (FR-25 to FR-28).
- Staff dashboard, customer list, runs monitor (FR-30 to FR-32).
- Legal pages: Terms of Service, Privacy Policy, Acceptable Use, Cookie notice (FR-33).
- Public landing page with sign-up and log-in card, SEO, video (FR-34, FR-35).
- Run attempts with handoff, Research flow settings, "taking longer" message (FR-36 to FR-38).

### Later
- Team members and invites; the customer flow editor and market Flow templates; a separate pricing page and blog; Removal list and public removal form; CRM sync and outreach; TikTok, chambers of commerce and directories; customer-visible access log for Acting as; banner and time limit while Acting as; Spanish.

## 6. Functional requirements

### FR-1: Sign up
**Story:** As Sam, I want to create an account so that I can find buyers for my products.
**Rules:**
- Input: business name (2–120 chars), your name (1–80), email (valid, ≤ 254, stored lowercased), password (10–128 chars).
- Creates a Business, an Owner Member and a session (signed in immediately), and sends a verification email (link valid 24 h).
- Fires `business_signed_up`.
**Errors / edge cases:** email already registered → 409 `EMAIL_TAKEN` with "An account with this email already exists. Log in or reset your password." Sign-up is rate-limited to 5 per IP per hour (429).
**Acceptance criteria:**
- Given a new email, when Sam submits valid details, then a Business and Owner exist, Sam lands on the welcome chat, and a verification email is sent.
- Given an email that already exists (any case), when Sam signs up, then 409 `EMAIL_TAKEN` and nothing is created.
- Given a 9-character password, when Sam signs up, then 400 `VALIDATION_ERROR` naming `password`.

### FR-2: Verify email
**Story:** As Sam, I want to confirm my email so that I get my free credits and can start research.
**Rules:**
- The link opens `/app/verify-email?token=…`; the token is single-use, stored hashed, valid 24 h.
- On success, sets `email_verified_at` and emits `MemberEmailVerified` (outbox), which grants the trial credits (FR-11).
- "Resend email" is available to a signed-in unverified Member, at most once per 60 s and 5 per day.
- Until verified, the app shows a slim notice "Verify your email to get 50 free credits and start research · Resend".
**Errors / edge cases:** expired or used token → 410 `TOKEN_EXPIRED`, page offers "Send a new link". Already verified → 200, no second grant.
**Acceptance criteria:**
- Given a valid token, when it's opened, then the email is verified and the wallet shows 50 credits.
- Given a used token, when it's opened again, then 410 and the balance is unchanged.
- Given a resend 30 s after the last one, then 429 `TOO_MANY_REQUESTS`.

### FR-3: Log in and log out
**Story:** As a Member, I want to log in and out securely.
**Rules:**
- Email + password. A DB session (ADR 0004), cookie valid 30 days sliding, 14 days idle timeout.
- After 5 failed attempts for an email or 20 per IP in 15 min → 429 for 15 min.
- For a Staff Member, a correct password returns `{ twoFactorRequired: true }` and a half-session that can only call the two-factor endpoints (FR-5).
- Logout deletes the session (and ends any Acting as).
**Errors / edge cases:** wrong email or password → 401 `INVALID_CREDENTIALS` with the same message for both.
**Acceptance criteria:**
- Given correct credentials of an Owner, when logging in, then a session cookie is set and `/api/auth/me` returns the Member and Business.
- Given 5 wrong passwords, when trying a 6th time (even correct), then 429.
- Given a signed-in Member, when logging out, then the cookie is cleared and `/api/auth/me` returns 401.

### FR-4: Password reset
**Story:** As a Member, I want to reset a forgotten password.
**Rules:**
- Request with an email → always 202 (no account enumeration); if the account exists, send a link valid 1 h, single-use, stored hashed.
- Confirm with token + new password (10–128) → updates the hash, deletes all of that Member's sessions, signs the Member in (Staff still need the two-factor step).
- Signed-in change: `PUT /api/auth/password` with current + new password.
**Errors / edge cases:** expired/used token → 410 `TOKEN_EXPIRED`. Requests rate-limited to 3 per email per hour.
**Acceptance criteria:**
- Given an unknown email, when requesting a reset, then 202 and no email is sent.
- Given a valid token, when setting a new password, then old sessions stop working and the new password logs in.

### FR-5: Staff accounts and two-factor sign-in
**Story:** As Staff, I want a second factor so that a stolen password can't open every customer's data.
**Rules:**
- `staff:grant <email>` (server command; see §4) sets `is_staff` on an existing Member; `staff:revoke` clears it and deletes their sessions.
- Two-factor uses TOTP (RFC 6238, 30 s, 6 digits, ±1 step), secret encrypted at rest (ADR 0012).
- First Staff login after the password step: setup screen shows a QR code and the secret; Staff confirms with a code. Afterwards every login needs a code.
- Codes are rate-limited: 5 wrong codes → the half-session is deleted and the Member starts over. Across sessions, 10 wrong codes per Member in an hour lock two-factor for an hour (429 `TWO_FACTOR_LOCKED`, one Audit log entry). A code that has passed can't be used again (the last accepted time step is stored).
- A session marks `two_factor_passed`. Back-office endpoints require Staff + `two_factor_passed`.
**Errors / edge cases:** wrong code → 401 `INVALID_CODE`; locked → 429 `TWO_FACTOR_LOCKED`. Lost authenticator: `staff:reset-2fa <email>` (server command).
**Acceptance criteria:**
- Given a Staff Member with two-factor set up, when the password is correct but no code is given, then no back-office endpoint is reachable (403 `TWO_FACTOR_REQUIRED`).
- Given a valid code, when submitted, then the session gets `two_factor_passed` and `/app/staff` loads.
- Given a non-Staff Member, when calling any `/api/staff/*`, then 403.

### FR-6: Acting as a Business
**Story:** As Staff, I want to use a customer's account as if I had signed in with their credentials so that I can see exactly what they see and help them.
**Rules:**
- From the customer list, "Act as" sets `acting_as_business_id` on the Staff session. Every customer endpoint then resolves the Actor as that Business's Owner, with `actingAsStaffId` set.
- Blocked while Acting as (403 `ACTING_AS_FORBIDDEN`): changing the email or password, buying credits (`POST /api/credits/checkout`), deleting the Business. The back office stays reachable.
- Runs started while Acting as are charged to the Business and stored with `started_by_staff_id`.
- Only one Business at a time; starting another replaces the first (logs end + start).
- "Stop acting as" is in the account menu; logging out also ends it. No banner and no time limit in this version (decision).
- Start and stop go to the Audit log; so does every state-changing request made while Acting as (FR-7).
- `/api/auth/me` returns `actingAs: { businessId, businessName }` so the account menu can show the stop item.
**Acceptance criteria:**
- Given Staff Acting as Business B, when opening `/app/plans`, then B's Plans are shown, not the Staff's own.
- Given Staff Acting as B, when trying to buy credits, then 403 `ACTING_AS_FORBIDDEN`.
- Given Staff Acting as B starts a run, then B's wallet is reserved and the run shows "Started by Staff" in the back office.
- Given Staff stops Acting as, then their own Business is shown again and the Audit log has start and stop entries.

### FR-7: Audit log
**Story:** As Staff, I want a record of every access and change made by Staff so that I can account for what happened in any customer account.
**Rules:**
- Entries are append-only: time, Staff Member, Business (nullable), action (dot-named, e.g. `acting_as.started`, `plan.updated`, `run.started`, `settings.ai.updated`, `credits.granted`, `tool.updated`), target type and id, details (JSON, never secrets; changed field names, not secret values).
- Written for: Acting as start and stop; every state-changing customer request while Acting as (via an HTTP hook, action from the route name); every back-office write.
- Back-office page lists entries newest first, filter by Business, Staff Member and action, cursor pagination (50).
- Customers do not see the log in this version.
**Acceptance criteria:**
- Given Staff Acting as B edits B's Plan, then an entry `plan.updated` with Staff, B and the plan id exists.
- Given Staff replace the Anthropic key, then an entry `settings.ai.updated` with details `{"fields":["anthropicApiKey"]}` exists and no key value appears in it.

### FR-8: Platform settings
**Story:** As Staff, I want to configure keys and services in the back office so that I can add providers and models without redeploying.
**Rules:**
- Sections and fields:
  - **AI:** Anthropic API key (secret); planning model (default `claude-opus-5-5`, used for plan drafting and scoring); fast model (default `claude-haiku-5-5`, used for chat extraction and website reading); chat model (default `claude-sonnet-5-5`).
  - **Data providers:** API key (secret) for Apify, Google Maps Platform (Places + Geocoding), Firecrawl, Apollo, Hunter, ZeroBounce, Twilio (account SID + auth token). Overpass needs none. Enable/disable lives with the Tool (FR-23).
  - **Email (SMTP):** host, port (default 2525), username, password (secret), TLS mode (`starttls`/`tls`/`none`), from name (default "Llyner Leads"), from address, reply-to.
  - **Stripe:** secret key (secret), webhook signing secret (secret), Stripe Tax on/off (default on).
  - **Analytics:** Google Analytics measurement ID (`G-` + 4–12 alphanumerics) or empty.
  - **Ceilings for all flows** (was Run limits): max credits per run (1,000), max leads per run (500), max active minutes (120), max total hours incl. retries (4), max attempts (5), trial credits (50). Flow settings (FR-37) must stay within these.
  - **Landing page:** YouTube video ID (11 characters) or empty (no video section).
  - **Support:** support email (shown on the legal pages and in emails).
- Secrets are encrypted with AES-256-GCM under `SETTINGS_ENCRYPTION_KEY` (env) and are write-only: the API returns `{ set: true, last4: "a1f3", updatedAt }`. Omitting a secret field keeps it; an empty string clears it.
- "Test" actions: Anthropic (1-token call), each provider (cheapest status call the provider allows), SMTP (sends "Test email from Llyner Leads" to the given address), Stripe (retrieve balance). Result `{ ok, message }` within 15 s.
- Changes take effect within 60 s on api and worker (settings cached ≤ 60 s).
- Each section save writes one Audit log entry with the changed field names.
**Errors / edge cases:** invalid measurement ID → 400; a model ID the Anthropic test rejects → the test shows the provider message; tests time out at 15 s with `{ ok: false, message: "Timed out" }`. A run that needs a missing key fails its Tool calls with `PROVIDER_NOT_CONFIGURED` (FR-23).
**Acceptance criteria:**
- Given Staff save an SMTP password, when reloading settings, then only `last4` is returned and the DB column holds ciphertext.
- Given valid SMTP settings, when "Send test email" to an address, then Mailpit (dev) receives it.
- Given a non-Staff Member, when `GET /api/staff/settings`, then 403.

### FR-9: Google Analytics and product events
**Story:** As Staff, I want page analytics and product events so that I can measure the goals.
**Rules:** If a measurement ID is set, the SPA loads gtag from `GET /api/public/config` at start and sends page views on route change; no user IDs or emails. Product events (§3a) are recorded server-side regardless. Back-office routes and Acting-as sessions don't send GA page views.
**Acceptance criteria:**
- Given no measurement ID, then no request to googletagmanager.com is made.
- Given a measurement ID, when navigating between routes, then a `page_view` is sent with the path only.

### FR-10: Credit wallet
**Story:** As Sam, I want to see my credits and where they went.
**Rules:**
- Balance = sum of ledger entries (ADR 0009). Reserved = open Reservations. Available = balance − reserved.
- Credits page: available, reserved, packs to buy, and the ledger newest first (type, credits ±, description e.g. "Run · Bakeries near Austin", date), cursor pagination (25).
- The header shows the available balance on every page.
**Acceptance criteria:**
- Given a grant of 1,000 and a settled run of 137, then available is 863 and the ledger shows both entries.
- Given a running run with 400 reserved, then reserved is 400 and available is balance − 400.

### FR-11: Trial credits
**Rules:** On `MemberEmailVerified` for an Owner, grant the configured trial credits (default 50) once per Business (unique key `trial:<businessId>`). Ledger type `grant`, description "Free trial credits".
**Acceptance criteria:**
- Given the event is delivered twice, then exactly one grant exists.

### FR-12: Buy Credit packs with Stripe
**Story:** As Sam, I want to buy more credits when I run out.
**Rules:**
- Active packs are listed with credits and price. "Buy" creates a Stripe Checkout Session (mode `payment`, cards only, automatic tax if Stripe Tax is on, `client_reference_id` = business id, metadata pack id) and redirects to it. Success URL `/app/credits?purchase=success`, cancel URL `/app/credits`.
- Credits are added only by the `checkout.session.completed` webhook when the session is paid, or by `checkout.session.async_payment_succeeded` for a payment that settles later (signature verified), idempotent by Stripe event id and by session id. `checkout.session.async_payment_failed` marks the purchase `failed`. Ledger type `purchase`, description "<pack name> pack".
- Only verified Owners, not while Acting as.
- Credits never expire and are not refundable: purchased credits can only be spent in the app (stated on the Credits page above the packs and in the Terms). Staff can still correct mistakes with an `adjustment` (FR-13).
**Errors / edge cases:** Stripe not configured → 503 `PAYMENTS_UNAVAILABLE`, button disabled with "Payments aren't set up yet". Inactive pack → 404. Webhook with bad signature → 400, nothing written.
**Acceptance criteria:**
- Given a completed checkout webhook, then the wallet increases by the pack's credits once, even if the webhook is delivered 3 times.
- Given the return to `/app/credits?purchase=success` before the webhook, then the page shows "Payment received, adding your credits…" and refreshes the balance every 3 s for up to 60 s.

### FR-13: Staff credit grants and Credit packs
**Rules:**
- Staff can add or remove credits for any Business with a reason (1–200 chars): ledger `adjustment`, can't take available below 0 (422 `INSUFFICIENT_CREDITS`).
- Staff manage packs: name, credits (1–1,000,000), price in cents (50–1,000,000), active. Seeded: Starter 2,500 / $25, Growth 11,000 / $100, Pro 30,000 / $250. One credit is worth $0.01 at list price.
- Both are logged in the Audit log.
**Acceptance criteria:**
- Given Staff grant 1,000 credits to B with reason "beta tester", then B's ledger shows an adjustment with that reason.

### FR-14: Welcome chat builds the Business Profile
**Story:** As Sam, I want to describe my business in a chat instead of filling in a form.
**Rules:**
- After sign-up, `/` shows the welcome Conversation until the profile is complete.
- The assistant (chat model) asks one question at a time, in this order unless already answered: what you sell (Products), where you're located (address or city), how far you deliver, who buys today (asked once, may be skipped). Price range and website are not asked as separate turns (changed in the build): the owner can mention them at any time or fill them in on the profile page.
- Each assistant turn returns: the reply text (≤ 600 chars), 0–4 quick replies, and structured profile updates (fast-model extraction against the profile schema) that are applied through profile's public API. The right-hand profile panel updates live.
- Address and city are geocoded (Google Geocoding) to a point; ambiguous → the assistant asks to confirm.
- The profile is complete when it has ≥ 1 Product, a geocoded location, and a delivery radius. Then the assistant asks for the Goal ("Who would you like to find?") and offers quick replies drafted from the Products, e.g. "Bakeries within 3 miles that could buy our cane sugar". Answering creates a Plan (FR-16) and opens it.
- Conversation is stored; reloading shows the history. Messages: user text 1–2,000 chars.
- Claude calls in the chat are not charged to the Business (Viper's acquisition cost) but are metered as Tool calls with no run for G-3.
**Errors / edge cases:** Claude unavailable or > 30 s → the message shows "I couldn't reply just now · Retry" and nothing is lost. Off-topic messages are answered briefly and steered back. Max 60 user messages per day per Business (429).
**Acceptance criteria:**
- Given the fake LLM scripted for a sugar distributor, when Sam answers the questions, then the profile has the Products, the geocoded Austin location and the 3-mile radius, and `profile_completed` fires with via `chat`.
- Given the LLM times out, then the user message is kept and Retry resends it.

### FR-15: Edit the Business Profile by hand
**Rules:** `/app/profile` shows every profile field and the Product list; each is editable (name 1–120, description ≤ 500, address fields, delivery radius 0–100 miles, current customers ≤ 500, price range ≤ 120, website URL). Products: add, edit, delete (a Product used by a Plan segment can't be deleted: 409 `PRODUCT_IN_USE`, "Remove it from your plans first"). Saving geocodes a changed address.
**Acceptance criteria:**
- Given the profile, when Sam adds a Product "Powdered sugar, 25 lb", then it appears in the chat's profile panel and in Plan product pickers.

### FR-16: Create a Plan from a Goal
**Story:** As Sam, I want to state what I want and get a concrete research plan.
**Rules:**
- Input: goal text (5–500 chars), from the chat or `/app/plans/new`. Requires a verified email (else 403 `EMAIL_NOT_VERIFIED`) and a complete profile (else 422 `PROFILE_INCOMPLETE`). At most 30 Plans per Business per UTC day (429 `TOO_MANY_REQUESTS`), since each one calls the planning model.
- The planning model drafts: a name (≤ 60), 1–5 Target segments (name, 1–6 Fit signals, 0–5 exclusions, the Product to pitch from the profile), and a Search area (centre = profile location unless the goal names another place, radius parsed from the goal else the delivery radius, clamped 1–25 miles).
- Guardrails default from the default Research flow's plan defaults (FR-37: max credits, max leads, min Fit score). If the Business's available credits are below the default max credits, max credits defaults to the available balance (minimum 10), so a trial Business can run on its 50 free credits.
- Returns the Plan with an estimate (FR-17). Fires `plan_created`.
**Errors / edge cases:** LLM failure → 503 `ASSISTANT_UNAVAILABLE`, goal text kept on screen. A goal naming a place that can't be geocoded → Plan uses the profile location and returns `warnings: ["We couldn't find '<place>', so we used your address."]`.
**Acceptance criteria:**
- Given the scripted fake LLM and goal "bakeries within 3 miles that could buy our sugar", then a Plan has a "Bakeries" segment pitching the sugar Product, centre = profile point, radius 3.

### FR-17: Edit a Plan and see the estimate
**Rules:**
- Editable at any time (runs use a snapshot): name; segments (add ≤ 5, remove ≥ 1 left, rename, Fit signals as chips, exclusions as chips, Product); Search area (place search → geocode, radius 1–25 miles, a map preview); guardrails (max credits 10..run-limit max, max leads 10..run-limit max, min Fit score 40–90).
- The first change to segments, Fit signals, exclusions or Product sets `icp_edited_at` and fires `plan_icp_edited`.
- Estimate shown before running: "Up to <maxCredits> credits · usually <typical>", where typical = median credits of the last 20 completed runs of the same flow with ≥ 1 lead, or 60% of max credits if fewer than 5 such runs. Also shows the Credit wallet's available balance.
**Acceptance criteria:**
- Given a radius of 30, when saving, then 400 naming `searchArea.radiusMiles`.
- Given a Plan never edited, when Sam changes a Fit signal, then `icp_edited_at` is set and stays set on later edits.

### FR-18: Start a Research run
**Rules:**
- "Find leads" on a Plan. Preconditions: verified email (403 `EMAIL_NOT_VERIFIED`), no other queued or running run for the Business (409 `RUN_IN_PROGRESS`), all Tools required by the flow's required steps enabled and configured (503 `RESEARCH_UNAVAILABLE`), available credits ≥ the Plan's max credits (402 `INSUFFICIENT_CREDITS` with `{ available, required }`).
- In one transaction: create the run (`queued`) with a snapshot of the Plan and the flow version, reserve max credits (ADR 0009), write `RunRequested` to the outbox. The worker enqueues it on BullMQ.
- Response 201 with the run; the UI goes to the working screen. Fires `run_started`.
**Acceptance criteria:**
- Given 300 available and max credits 400, then 402 with `{ available: 300, required: 400 }`, and the UI offers "Lower the budget to 300" and "Buy credits".
- Given a valid start, then a Reservation of 400 exists and the run is `queued`.

### FR-19: The "Local buyers" Research flow
**Rules:** The flow is a seeded Flow template (data, ADR 0011). Its settings (run limits, plan defaults, per-step budget share, time limit and required/optional) are edited by Staff (FR-37); the numbers below are the seeded defaults. A run snapshots the flow version and its settings when it starts. The worker runs Steps in order; inside a Step, a Claude agent loop (planning model unless noted) may call only that Step's allowed Tools through the `ToolRunner`. A Checkpoint (JSON state: prospect ids, cursors, step outputs) is saved after each Step; a retried job resumes after the last Checkpoint.

| # | Step | Allowed Tools | Budget share | Done when |
|---|------|---------------|--------------|-----------|
| 1 | Search terms | Claude (fast) | 2% | 3–8 search terms per segment (e.g. "bakery", "pastry shop", "café that bakes") |
| 2 | Maps & places | Google Places Text Search, Apify Google Maps scraper, Overpass (OSM) | 30% | every term searched in the area, or 400 Prospects, or budget share used |
| 3 | Merge | none (leads.merge) | 0% | Prospects deduplicated (place id, normalised phone, domain, name + 50 m), places already delivered for this Plan dropped |
| 4 | Pre-score | Claude (fast) | 5% | each Prospect scored 0–100 from name, category, rating; top 3× max leads kept |
| 5 | Websites | Firecrawl, Claude (fast) | 20% | each kept Prospect with a website read: what they make or serve, emails, phones, socials, owner names |
| 6 | Socials & reviews | Apify Instagram profile scraper, Apify Yelp scraper | 13% | Instagram/TikTok/Yelp links checked for the top Prospects; bio, followers, review snippets as Evidence |
| 7 | Contacts | Apollo, Hunter | 10% | an email found for each top Prospect where possible |
| 8 | Verify | ZeroBounce, Twilio Lookup | 8% | every email and phone of the top Prospects checked |
| 9 | Score & pitch | Claude (planning) | 12% | Fit score with Evidence (each with Source and points) and a Pitch per Prospect |
| 10 | Deliver | none (leads.deliver) | 0% | Leads created per FR-25 |

- Claude is itself a Tool (`claude.fast`, `claude.planning`), called and metered through the `ToolRunner` like any provider. The agent loop of Steps 2, 6, 7 and 8 runs on the fast model (one planning-model turn per item would spend most of a 400-credit budget); Score & pitch uses the planning model.
- Seeded Step time limits (minutes, Steps 1–10): 2 / 12 / 1 / 4 / 12 / 6 / 5 / 6 / 10 / 2 = 60, the flow's max active time. Server validation refuses step time limits that add up to more than the max active time (422 `STEP_TIME_OVER_ACTIVE_TIME`).

- A Step whose Tool is disabled is skipped if the Step is optional (6, 7) and the run records it; steps 2, 8 and 9 are required.
- Unused budget share carries to the next Step.

**Every step is stored, so a run resumes where it stopped:**
- Each Step has a database record (status, attempts, progress, Checkpoint). Progress is saved after **every Tool call**, not only at the end of the Step: which search terms, Prospects or websites are done and which are left.
- Every Tool call is stored with its input hash and its output (or error) before the runner moves on. On a retry, a Tool call with the same Tool and input is answered from the stored output: not called again, not charged again.
- Prospects, contacts and Evidence are written to the database as they are found, not held in memory.
- If the job dies (crash, deploy, worker restart) or a Step fails, BullMQ retries the job automatically up to 3 times (after 1, 5 and 15 minutes). Each retry starts at the first unfinished Step and skips the work already stored inside it.
- After 3 failed attempts the run is `failed` and settled under the FR-20 failure policy. Staff (FR-32) or the Owner ("Try again", FR-21) can resume it later: a new Reservation for the remaining budget, the same run, starting from the stored progress. Work already stored is never charged twice.
**Acceptance criteria:**
- Given fake Tools with fixture data for 30 Austin bakeries, when a run executes, then each Step records its Tool calls and a Checkpoint, and the run delivers the expected Leads.
- Given the worker crashes after Step 5, when the job retries, then Steps 1–5 are not repeated and no Tool call from them is charged twice.
- Given the worker crashes in Step 5 after 12 of 30 websites were read, when the job retries, then those 12 websites are not fetched or charged again and Step 5 continues with the 13th.
- Given a provider is down for 10 minutes, when the run fails its first attempt, then the automatic retry resumes it and the run completes.

### FR-20: Guardrails and Settlement
**Rules:**
- All thresholds below come from the run's flow settings snapshot (seeded values shown). The runner stops a Step when its budget share or its time limit is used, and stops collection (Steps 2–7) when total spend reaches 80% of max credits or 45 minutes of active time have passed, moving to Verify, Score and Deliver with what it has (`budget_reached` / `time_reached` set).
- Hard stops: max credits (no Tool call may start if its max cost would exceed the reservation; the call is skipped, the current Step ends, the remaining Steps are skipped and Deliver runs with what was found, so a run that runs out of budget delivers partial results), the flow's max active time (60 min) and max total time including retries (3 h): the run is failed with `TIME_LIMIT`, keeping delivered Leads if Step 10 finished.
- Each Tool call's cost is metered in millicredits (Rate card × units). At the end: credits spent = ceil(sum / 1000), settlement entry for that amount, release of the rest of the Reservation.
- Failure policy: if a run fails and delivered 0 Leads, credits spent = 0 (Viper absorbs the provider cost; tool calls still record provider cost). If it delivered ≥ 1 Lead, the real cost is charged. Waived cost stays waived: if a failed 0-Lead run is resumed ("Try again" or Staff "Resume"), only the spend after the resume can be charged.
- Cancel (FR-21): settles the real cost so far; no Leads unless Step 10 had run.
- A provider error is retried up to 3 times with backoff (1 s, 4 s, 16 s); a Tool that fails 5 calls in a row is disabled for that run. A required Step with zero successful calls fails the run with `PROVIDER_ERROR`.
**Acceptance criteria:**
- Given tool calls totalling 136,200 millicredits, then the settlement is 137 credits and 263 are released from a 400 Reservation.
- Given a run fails in Step 2 with no Leads, then the settlement is 0 and the full Reservation is released.
- Given spend reaches 80% during Step 5, then Steps 6–7 are skipped, Verify and Score run, and `budget_reached` is true.

### FR-21: Working screen and cancel
**Rules:**
- `/app/runs/:id` shows "Working on it", the Plan name, a calm step checklist (done / current / to do, Step names only, no logs), elapsed time, and "We'll email you when your leads are ready. You can close this page." Polls every 10 s.
- Cancel (confirm dialog) → run `cancelled` after the current Tool call finishes.
- When completed, the page switches to "<n> leads ready · <credits> credits · <cost per lead> per lead" with "See leads". After the flow's max active time without finishing, the page also shows FR-38's message. When failed: "This run didn't finish. You were charged <n> credits." with the reason in plain words and a "Try again" button that resumes the run from where it stopped (needs available credits for the remaining budget).
**Acceptance criteria:**
- Given a running run, when Sam opens its page, then the current Step is highlighted and no Tool names or logs are shown.

### FR-22: Run emails
**Rules:** On `RunCompleted` email the Owner: subject "Your leads are ready: <plan name>", count, credits spent, button to the Lead list. A completed run with 0 new Leads sends "No new leads this time: <plan name>" instead. On `RunFailed`: subject "Your research run didn't finish", credits charged, link to the Plan. Also email the support address on every `RunFailed`. Sent through the `EmailSender` (SMTP adapter) from the outbox; retried 5 times. Not sent if the run was started by Staff while Acting as (Staff see it in the back office instead).
**Acceptance criteria:**
- Given a run completes, then exactly one email reaches Mailpit for the Owner even if the event is delivered twice.

### FR-23: Tool catalog, Rate card and metering
**Rules:**
- Tools are code with a key, name, provider, unit (e.g. "request", "result", "page", "email", "lookup", "1k tokens in", "1k tokens out"), provider cost per unit (microdollars), credits per unit (decimal, 3 places), enabled.
- Staff page lists Tools with: enabled toggle, unit, provider cost, credits per unit, implied margin (1 − provider cost / (credits × $0.01)), configured (key present), health (calls, error rate, last error in 24 h). Margin under 60% is highlighted.
- `ToolRunner.call(runId, stepKey, toolKey, input)`: checks enabled and configured (else `PROVIDER_NOT_CONFIGURED`), checks the run's remaining budget against the Tool's max cost for the call, calls the adapter, records a Tool call (units, millicredits, provider cost micros, status, duration, error), and returns the output.
- Seeded Rate card is set for ≥ 60% margin from current provider list prices; Staff adjust it.
**Acceptance criteria:**
- Given a disabled Tool, when called, then no adapter call happens and the result is `TOOL_DISABLED`.
- Given a successful call of 20 units at 1.5 credits/unit, then the Tool call records 30,000 millicredits.

### FR-24: Provider adapters
**Rules:** One adapter per Tool, with input/output Zod schemas, reading its key from Platform settings: Google Places Text Search (New), Google Geocoding, Apify actors (Google Maps scraper, Instagram profile scraper, Yelp scraper; run-sync with item limit), Overpass (OSM, public endpoint, 1 req/s), Firecrawl scrape (markdown), Apollo people/organization enrichment, Hunter domain search, ZeroBounce validate, Twilio Lookup v2 (line type), Anthropic Messages (metered by tokens). All return normalised data with a Source (name, URL, retrieved at). Tested against recorded fixtures only (ADR 0005); never against live APIs in CI.
**Acceptance criteria:**
- Given each adapter's recorded fixture, then it returns normalised output and its unit count.

### FR-25: Qualification and delivery
**Rules:** A Prospect becomes a Lead only if all hold: Fit score ≥ the Plan's minimum; at least one Verified phone or email (ZeroBounce `valid`, or Twilio valid number); not already delivered for this Plan; it is a business (not a person's home listing). Leads are ranked by Fit score and capped at max leads. Every contact and Evidence item keeps its Source. Unverified contacts may be shown, marked "Not verified"; invalid ones are dropped.
**Acceptance criteria:**
- Given a Prospect with Fit score 85 but only an invalid email and no phone, then it is not delivered.
- Given a place delivered in an earlier run of the same Plan, then a new run doesn't deliver or charge for it again.

### FR-26: Lead list and lead detail
**Story:** As Sam, I want to work through my leads quickly.
**Rules:**
- `/app/plans/:id/leads`: list on the left (name, category, distance, Fit score, contact icons, Feedback state), preview on the right (DESIGN.md list + preview). Filters: run (default all), min Fit score, Feedback (all / good / not a fit / none), search by name. Sort: Fit score desc (default), distance, newest. J/K moves, Esc closes the preview. Cursor pagination 50.
- Detail (`/app/leads/:id` deep link and preview): name, category, address with distance, phone(s), email(s), website, Instagram, TikTok, Yelp, Facebook (each with Verified state and Source), Fit score with the Evidence list (fact, points, Source link and date), Pitch (Product + reason), the Plan and run.
- Stats strip above the list: leads, average Fit score, % verified contacts, credits, cost per lead.
**Empty states:** no runs yet → "No leads yet. Start research from your plan." with a button. Run in progress → link to the working screen.
**Acceptance criteria:**
- Given 25 Leads, when pressing J twice, then the third Lead is previewed.
- Given a Lead, then every contact shows its Source on hover/focus.

### FR-27: Feedback
**Rules:** "Good lead" / "Not a fit" on each Lead (G, N keys in the preview); "Not a fit" offers optional reasons (chips: "Wrong type of business", "Too far", "Closed", "Already a customer", "Bad contact info", other text ≤ 200). Feedback can be changed or cleared. Fires `lead_feedback_given`.
**Acceptance criteria:**
- Given a Lead marked Not a fit with "Closed", when reloading, then the state and reason are kept.

### FR-28: CSV export
**Rules:** "Export CSV" on the Lead list exports the current filter as UTF-8 CSV (streamed, `GET`), columns: business_name, category, address, distance_miles, phone, phone_verified, email, email_verified, website, instagram, tiktok, yelp, fit_score, pitch_product, pitch_reason, feedback, sources (semicolon-separated URLs), delivered_at. File name `llyner-leads-<plan-slug>-<yyyy-mm-dd>.csv`. Values beginning with `=`, `+`, `-`, `@` are prefixed with `'` (CSV injection). Fires `leads_exported`.
**Acceptance criteria:**
- Given 25 Leads and filter "good", then the CSV has the header and only the good Leads.

### FR-29: Removal list (deferred)
Not in this version (founder's decision, 2026-11-19). The number is kept so FR numbers stay stable.

### FR-30: Staff dashboard
**Rules:** `/app/staff` with period 7 / 30 / 90 days (default 30), comparing to the previous period. Tiles:
- **Customers:** total Businesses; new sign-ups (chart by day); verified; active (≥ 1 run in period); paying (≥ 1 purchase ever); trial-to-paid % (paying ÷ verified, for Businesses older than 14 days).
- **Revenue & credits:** pack revenue ($, period); credits granted / purchased / spent (period); total unspent credits (all Businesses).
- **Runs:** started; completed %; within 60 min and budget % (G-5); median duration; average credits per run; failed runs list (link to run).
- **Leads:** delivered; Good lead % (G-1, of Leads with Feedback); verified-contact % (G-2); provider cost per Lead ($) and credits per Lead; gross margin % (G-3) = 1 − provider cost ÷ (credits spent × $0.01).
- **Plans:** % of runs from Plans with no ICP edits (G-4).
- **North star:** Good leads per active Business per week.
- **Providers:** spend by Tool ($, period) and error rate.
- **Tables:** top 10 Businesses by credits spent; latest 10 sign-ups (each with "Act as").
Staff's own Business and Businesses marked internal are excluded from customer and revenue tiles but included in run and lead quality tiles (customer #1's runs test A-1..A-4).
**Acceptance criteria:**
- Given the seed data, when opening `/app/staff`, then every tile shows a number or "—" (no data), and the dashboard loads in < 1 s p95.

### FR-31: Customer list
**Rules:** `/app/staff/customers`: search by business name or Owner email; columns business, Owner email, signed up, verified, available credits, runs, Leads delivered, last active, paying; sort by signed up (default) or last active; cursor pagination 50. Row actions: Act as (FR-6), Grant credits (FR-13), mark internal.
**Acceptance criteria:**
- Given search "bakery", then only matching Businesses show.

### FR-32: Runs monitor
**Rules:** `/app/staff/runs`: all runs with status, Business, Plan, started by (Owner / Staff), duration, credits, provider cost, Leads; filter by status and Business. `/app/staff/runs/:id`: Steps with status, duration, credits, Checkpoint size, and the Tool calls (Tool, units, credits, provider cost, status, error, duration). A failed run can be **resumed** as a new attempt from its last handoff (new Reservation for the remaining budget; same run id; Audit log). The list shows the flow version, an Attempts column (`2/3`) and the status `↻ Retrying · attempt n of m · from step k`; the detail shows the attempt timeline and each attempt's handoff (FR-36). Queue health: waiting, active, failed and retrying runs, stalled runs found by the sweeper, worker heartbeat (last seen).
**Acceptance criteria:**
- Given a run failed in Step 6, when Staff resume it, then Steps 1–5 are not re-run and the run continues from Step 6.

### FR-33: Legal pages
**Rules:**
- Public pages, readable without logging in, rendered from Markdown in `apps/web/src/content/legal/`, each with a "Last updated" date:
  - `/terms` Terms of Service: the service, accounts, credits (prepaid, never expire, **no refunds**, spent only in the app), acceptable use, customer obligations when contacting Leads (CAN-SPAM: identify yourself and offer an opt-out in cold email; TCPA: no auto-dialled or pre-recorded calls or texts to mobile numbers without consent; follow state rules), data accuracy disclaimer (public data, no guarantee), limitation of liability, termination, governing law `[founder's state]`.
  - `/privacy` Privacy Policy: what we collect from customers (account, profile, payments via Stripe, usage analytics, Google Analytics cookies), what business data we collect from public sources and why, providers we share data with (Anthropic, Apify, Google, Stripe, email provider, DigitalOcean), retention, customers' rights (access and deletion by emailing support), California notice (CCPA), contact.
  - `/acceptable-use` Acceptable Use Policy: no consumer targeting, no harassment or spam, no resale of raw lead data as a list product, no unlawful discrimination, Staff may suspend accounts that break it.
  - `/cookies` Cookie notice: session cookie (necessary) and Google Analytics cookies (only when GA is configured).
- Drafts are written by Claude in W1 (WP-4) from this PRD and reviewed by the founder; a lawyer's review is recommended before charging outside customers.
- Sign-up shows "By signing up you agree to the Terms of Service and Privacy Policy" with links; the footer of public pages and the account menu link to all four.
**Acceptance criteria:**
- Given a visitor, when opening `/terms`, `/privacy`, `/acceptable-use` or `/cookies`, then the page renders without logging in.
- Given the Terms, then they state that credits never expire and are not refundable.

### FR-34: Public landing page
**Story:** As a visitor from search, an ad or a shared link, I want to understand the product and its price before signing up.
**Rules:**
- `/` is rendered on the server by the api (React `renderToString` with the Midnight components; ADR 0016) and cached for 5 minutes. Sections: header (logo, How it works, Features, Pricing, FAQ, Log in, Start free), hero with the sign-up/log-in card (FR-35) and the product video, How it works (3 steps), Features (6), sample lead card, Pricing (active Credit packs read live, "50 free credits", "never expire", "not refundable", sales tax note), FAQ (5), final call to action, footer with legal links.
- Video: shown only when a YouTube video ID is set (FR-8). A thumbnail with a play button; the YouTube iframe (youtube-nocookie.com) loads only on click.
- SEO: unique `<title>` and meta description, canonical URL, Open Graph and Twitter tags with a share image, JSON-LD (`SoftwareApplication` with `offers` from the packs, `FAQPage`, `VideoObject` when a video is set), `/sitemap.xml` (the site pages) and `/robots.txt` (disallow `/app` and `/api`). Legal pages (FR-33) are served the same way.
- Google Analytics page views when a measurement ID is set (FR-9).
- A signed-in visitor sees the page with "Open the app" (→ `/app`) in place of the card.
**Acceptance criteria:**
- Given a crawler without JavaScript, when it requests `/`, then the HTML contains the headline, the pack prices and the JSON-LD.
- Given a pack price changed in the back office, then `/` shows it within 5 minutes.
- Given no video ID, then no video section and no request to YouTube.
- Lighthouse on `/` (mobile): SEO ≥ 95, Performance ≥ 90, Accessibility ≥ 95.

### FR-35: Sign-up and log-in card on the landing page
**Rules:**
- One card with two tabs, Create account (default) and Log in. Every "Start free" scrolls to it.
- Works without JavaScript: the forms post to `POST /site/signup` and `POST /site/login`, which reuse the identity use cases (FR-1, FR-3) and redirect: sign-up → `/app` (welcome chat), log-in → `/app` (Staff → `/app/login/two-factor`). With JavaScript, the same forms call the JSON API and navigate.
- Errors render in the card: field errors inline; an email already used switches to the Log in tab with the email filled in and the message "You already have an account. Log in instead."
- The card's forms carry the same Origin/CSRF protection and rate limits as the API. `business_signed_up` gets `source: landing`.
- `/app/signup` and `/app/login` stay for direct links and redirects.
**Acceptance criteria:**
- Given JavaScript off, when a visitor submits the Create account tab with valid data, then they land on `/app` signed in.
- Given an email already used, when submitting Create account, then the Log in tab is shown with that email filled in.

### FR-36: Run attempts and handoff
**Story:** As Staff, I want a failed or stalled run to continue where it stopped, so customers get their leads without paying twice.
**Rules:**
- Every execution of a run is an **attempt** (1, 2, …). Each records start, end, the step and item it started from, the step and item it reached, and how it ended: `completed`, `retryable_error`, `final_error`, `worker_stopped`, `cancelled`.
- The runner saves a **handoff** after every Tool call (in the same transaction as the Tool call record): current step, items done and left, the agent's working notes (≤ 2,000 chars, written by the agent each turn: what it learned, what worked, what to try next), the last error, credits left and active time left.
- A new attempt starts a **new agent session** whose first prompt is built from the plan snapshot, the step's goal and the handoff (never the old transcript). Tool calls already stored are answered from storage (same Tool + input hash) and not charged again. Full transcripts are kept 90 days for Staff and never fed back to the agent.
- **Retryable** errors (crash, deploy, timeout, provider error, rate limit) end the attempt; if attempts and total time remain, the next attempt is queued after the flow's wait (1, 5, 15 min). **Final** errors (credits exhausted, provider not configured, invalid plan) fail the run at once.
- **Lease and heartbeat:** the worker holding an attempt renews a lease every 30 s. A sweeper (every 30 s) ends any attempt whose lease expired (flow setting "worker stopped after", default 5 min, minimum 5, because one provider call with its retries can take about 5 min) as `worker_stopped` and queues the next attempt.
- One Reservation covers all attempts. Active time counts only while an attempt runs; total time counts from the first start.
- When attempts or total time run out, the run is `failed` and settled per FR-20. Owner "Try again" and Staff "Resume" start a new attempt beyond the automatic ones (and need credits for the remaining budget).
**Acceptance criteria:**
- Given the worker is killed in Step 5 after 12 of 30 websites, when the sweeper runs after the lease expires, then attempt 2 starts at website 13, its first prompt contains the handoff notes, and none of the 12 stored calls is repeated or charged.
- Given a provider error on every call, when 3 attempts have failed, then the run is `failed` with the failure policy applied.
- Given credits run out mid-step, then no further attempt is queued: the run delivers what it has, and fails with `INSUFFICIENT_CREDITS` only when there is nothing to deliver.

### FR-37: Research flow settings (Staff)
**Rules:**
- `/app/staff/flows` lists flows (this version: "Local buyers", the default). Staff edit its run settings (max active time, max total time, attempts, waits between attempts, worker-stopped timeout, start-scoring thresholds), plan defaults (max credits, max leads, min Fit score) and each Step's budget share (%, must total 100), time limit (min) and required/optional (Steps 2, 8, 9 always required).
- Every value is validated against the platform ceilings (FR-8); an invalid value shows the ceiling ("Ceiling 4 h (Settings)").
- Saving creates a new flow version; new runs use it; runs already started keep theirs. Each save is an Audit log entry with the changed fields.
**Acceptance criteria:**
- Given max total time 5 h and a ceiling of 4 h, when saving, then 400 naming `runSettings.maxTotalHours`.
- Given budget shares adding up to 95%, when saving, then 400 "Step budget shares must add up to 100%".
- Given a run in progress on v3, when Staff save v4, then the running run keeps v3's limits.

### FR-38: "Taking a little longer" message
**Rules:** On the customer's Working screen (FR-21), once the run's active time passes the flow's max active time, or while a retry is waiting, show "Taking a little longer than usual. We're still on it and you won't be charged twice for work already done." No attempt numbers, errors or Tool names are shown to customers.
**Acceptance criteria:**
- Given a run in its second attempt, when the customer opens `/app/runs/:id`, then the message shows and no attempt number appears.

## 6a. Acceptance journeys

### AJ-1: Sign up and describe the business
**Persona:** Sam · **Covers:** FR-1, FR-2, FR-11, FR-14
1. Open `/app/signup`, enter "Sweet Supply Co", "Sam", a new email, a password.
2. Land on the welcome chat; the notice says to verify the email.
3. Open the verification link from Mailpit; the header shows 50 credits.
4. Answer the assistant's questions (fake LLM): sells cane sugar and powdered sugar, Austin TX, delivers within 3 miles, sells to restaurants today.
5. The profile panel fills in as answers arrive.
**Expected:** profile complete, assistant asks "Who would you like to find?" with quick replies.

### AJ-2: Goal to leads
**Persona:** Sam · **Covers:** FR-16, FR-17, FR-18, FR-19, FR-20, FR-21, FR-22, FR-25, FR-26, FR-27, FR-28
1. From AJ-1's end, click the quick reply "Bakeries within 3 miles that could buy our cane sugar".
2. The Plan opens with a Bakeries segment, Fit signals as chips, a 3-mile map, "Up to 400 credits".
3. Click "Find leads"; the working screen shows the step checklist.
4. The run (fake Tools, fixtures) completes; the page shows "n leads ready".
5. Mailpit has "Your leads are ready".
6. Open the list, press J to move, mark one "Good lead" and one "Not a fit · Closed".
7. Export CSV.
**Expected:** Leads with Fit scores, Evidence and verified contacts; the wallet shows the settled cost and the released Reservation; the CSV has the Leads.

### AJ-3: Buy a Credit pack
**Persona:** Sam · **Covers:** FR-10, FR-12
1. Open `/app/credits`, click "Buy" on Starter.
2. Fake Stripe Checkout (test double) completes and the webhook fires.
3. Back on `/app/credits?purchase=success`.
**Expected:** available balance + 2,500 and a "Starter pack" ledger entry.

### AJ-4: Not enough credits (failure path)
**Persona:** Sam · **Covers:** FR-17, FR-18, FR-10
1. Seeded Business with 120 credits opens its Plan (max credits 400).
2. Click "Find leads".
**Expected:** a message "You need 400 credits, you have 120" with "Lower the budget to 120" and "Buy credits"; choosing "Lower the budget" sets max credits to 120 and starting works.

### AJ-5: A run that fails is free (failure path)
**Persona:** Sam · **Covers:** FR-20, FR-21, FR-22, FR-32
1. Fake Places, Apify Maps and Overpass Tools are set to error (Step 2 falls back to Overpass, so it must fail too).
2. Start a run.
**Expected:** the working screen shows "This run didn't finish. You were charged 0 credits."; the full Reservation is released; "didn't finish" email in Mailpit; Staff see the run failed with `PROVIDER_ERROR` in `/app/staff/runs`.

### AJ-6: Staff sign in and Act as a customer
**Persona:** Staff · **Covers:** FR-3, FR-5, FR-6, FR-7, FR-30, FR-31
1. Log in as `staff@demo.test`, enter the TOTP code (seeded secret).
2. `/app/staff` dashboard shows tiles.
3. Customers → search "Sweet" → Act as.
4. The app shows Sweet Supply Co's Plans and Leads; try to buy credits → blocked message.
5. Account menu → Stop acting as.
6. Audit log shows `acting_as.started` and `acting_as.stopped`.
**Expected:** Staff are back in their own Business; the log has both entries.

### AJ-7: Configure the platform
**Persona:** Staff · **Covers:** FR-8, FR-23
1. `/app/staff/settings` → Email: set SMTP to Mailpit, "Send test email".
2. AI: replace the Anthropic key; only the last 4 characters show after saving.
3. Tools: disable "Apify Yelp scraper", change Places credits per unit.
**Expected:** the test email arrives; the key is masked; the Tool shows disabled and the new margin; four Audit log entries exist (`settings.email.updated`, `settings.ai.updated`, and one `tool.updated` per Tool).

### AJ-8: From the landing page to the welcome chat
**Persona:** Sam · **Covers:** FR-34, FR-35, FR-1, FR-14
1. Open `/` (JavaScript on); check the pricing shows the three packs.
2. Fill the Create account tab and submit.
3. Land on `/app` with the welcome chat and the verify-email notice.
4. Log out; open `/`, use the Log in tab with the same email; land on `/app/plans` or the chat.
**Expected:** signed in from the landing card both ways; the email-taken case switches tabs.

### AJ-9: A run survives a worker crash (failure path)
**Persona:** Staff · **Covers:** FR-36, FR-32, FR-38
1. Start a run (fake Tools, test hook makes the worker stop in Step 5 after 12 websites).
2. The customer's Working screen shows "Taking a little longer than usual".
3. After the lease expires, attempt 2 resumes and the run completes.
4. Staff open the run detail.
**Expected:** run completed with 2 attempts; the timeline shows attempt 1 `worker_stopped` at website 12 and attempt 2 from website 13; attempt 2 resumes from item 13, so the 12 stored calls are never repeated or charged (none shows as reused); settlement equals one pass of work.

## 6b. Screens
Mocks (Design artifacts, approved 2026-11-19): all screens, clickable: https://claude.ai/artifact/1DYM1YFA2fMHHQLrXHgWXY · landing page, /app routes and first view after login (before/after): https://claude.ai/artifact/SzcSuuq9Nz1ALirN1nTiPb · run retries and Research flows (before/after, mobile and desktop): https://claude.ai/artifact/DpVT9k1m85Lxqor35ZPLDg. Mobile versions of the remaining screens follow the same layout rules (DESIGN.md) and are reviewed in the wave demos.

All screens follow DESIGN.md (Midnight); mockups on the design canvas (Midnight row).

| Screen | Route | Purpose | Empty / loading / error states |
|--------|-------|---------|--------------------------------|
| Sign up | `/app/signup` | FR-1 | field errors inline; 409 message with login link |
| Log in | `/app/login` | FR-3 | generic error; 429 "Too many attempts, try again in 15 minutes" |
| Two-factor | `/app/login/two-factor` | FR-5 (code, or QR setup on first login) | wrong code inline |
| Verify email | `/app/verify-email` | FR-2 | expired → "Send a new link" |
| Forgot / reset password | `/app/forgot-password`, `/app/reset-password` | FR-4 | "If an account exists, we've sent a link" |
| Welcome chat | `/app` (until profile complete) and `/app/chat` | FR-14 | typing indicator; failed reply → Retry |
| Business Profile | `/app/profile` | FR-15 | skeleton; save errors inline |
| Plans | `/app/plans` | list Plans with last run and leads | empty → "Tell us who you want to find" + New plan |
| New plan | `/app/plans/new` | goal box → FR-16 | drafting spinner "Drafting your plan…" |
| Plan | `/app/plans/:id` | FR-17, start run FR-18 | 402 dialog (AJ-4); run in progress → link |
| Working | `/app/runs/:id` | FR-21 | completed / failed / cancelled states |
| Lead list + preview | `/app/plans/:id/leads`, `/app/leads/:id` | FR-26, 27, 28 | no leads; filters with no match → "No leads match these filters · Clear" |
| Credits | `/app/credits` | FR-10, FR-12 | payments unavailable; purchase pending |
| Legal pages | `/terms`, `/privacy`, `/acceptable-use`, `/cookies` | FR-33 | — |
| Staff dashboard | `/app/staff` | FR-30 | "—" for empty tiles |
| Customers | `/app/staff/customers` | FR-31, FR-6, FR-13 | no results |
| Runs | `/app/staff/runs`, `/app/staff/runs/:id` | FR-32 | — |
| Tools & Rate card | `/app/staff/tools` | FR-23 | "Not configured" badge |
| Credit packs | `/app/staff/packs` | FR-13 | — |
| Settings | `/app/staff/settings` | FR-8 | test results inline |
| Research flows | `/app/staff/flows` | FR-37 | validation against ceilings inline |
| Landing page (server-rendered) | `/` | FR-34, FR-35 | card errors inline; signed in → "Open the app" |
| Audit log | `/app/staff/audit-log` | FR-7 | empty |

The icon rail shows: Chat, Plans, Leads, Credits, and (Staff only) Back office. The account menu shows the Business name, Profile, the legal pages, Log out, and while Acting as, "Stop acting as <Business>" (returns to `/app/staff/customers`).

Navigation map: https://claude.ai/artifact/WFQ2BzxSvSxbhwFaUTgz1v. Routing rules:
- Not signed in → `/app/login`, then back to the requested page. Signed in on `/app/login` or `/app/signup` → home.
- `/app` shows the welcome chat until the profile is complete, then redirects to `/app/plans`. `/` is the public landing page (FR-34).
- The Leads rail item opens the most recent Plan's Lead list, with a plan switcher at the top (no Plans → the Plans empty state).
- Staff after the password step → `/app/login/two-factor` until the code is accepted. Non-Staff on `/app/staff/*` → "Page not found"; the Staff rail item is hidden.
- A Plan with a queued or running run shows "View progress" (→ `/app/runs/:id`) instead of "Find leads".
- Unknown routes → "Page not found" with a link home.

## 7. Interfaces
Conventions: JSON; ids are UUID v7 strings; times ISO 8601 UTC; credits are integers; money in cents; errors `{ error: { code, message, fields?: { [path]: message } } }`. Lists: `?cursor=&limit=` (limit default 25 unless stated, max 100) → `{ items, nextCursor: string | null }`. Auth: `session` = signed-in Member (Acting as resolves to the target Business's Owner); `staff` = Staff with `two_factor_passed`, not affected by Acting as. Every state-changing request checks `Origin` (ADR 0004). All endpoints: 401 when not signed in, 403 when the role doesn't allow it.

Shared shapes:
- `Me = { member: { id, name, email, emailVerified: bool, isStaff: bool }, business: { id, name }, actingAs: { businessId, businessName } | null, twoFactor: { required: bool, passed: bool, setUp: bool } }`
- `Money = { cents: int, currency: "usd" }`
- `Source = { name: string, url: string | null, retrievedAt: string }`

### Identity
- `POST /api/auth/signup`: public. Req `{ businessName, name, email, password }`. 201 `Me`. Errors 400, 409 `EMAIL_TAKEN`, 429.
- `POST /api/auth/verify-email`: public. Req `{ token }`. 200 `{ verified: true }`. Errors 410 `TOKEN_EXPIRED`.
- `POST /api/auth/verify-email/resend`: session. 202. Errors 429.
- `POST /api/auth/login`: public. Req `{ email, password }`. 200 `Me` (Staff: `twoFactor.required=true, passed=false`). Errors 401 `INVALID_CREDENTIALS`, 429.
- `POST /api/auth/two-factor/setup`: half-session Staff without setup. 200 `{ otpauthUrl, secret, qrSvg }`.
- `POST /api/auth/two-factor/verify`: half-session Staff. Req `{ code: /^\d{6}$/ }`. 200 `Me`. Errors 401 `INVALID_CODE`, 429 (`TWO_FACTOR_LOCKED` when locked).
- `POST /api/auth/logout`: session. 204.
- `GET /api/auth/me`: session. 200 `Me`.
- `POST /api/auth/password-reset`: public. Req `{ email }`. 202.
- `POST /api/auth/password-reset/confirm`: public. Req `{ token, password }`. 200 `Me`. Errors 400, 410.
- `PUT /api/auth/password`: session, not Acting as. Req `{ currentPassword, newPassword }`. 204. Errors 401 `INVALID_CREDENTIALS`, 403 `ACTING_AS_FORBIDDEN`.
- `POST /api/staff/acting-as`: staff. Req `{ businessId }`. 200 `Me`. Errors 404.
- `DELETE /api/staff/acting-as`: staff. 200 `Me`.

### Platform
- `GET /api/public/config`: public. 200 `{ gaMeasurementId: string | null, supportEmail: string | null, youtubeVideoId: string | null }`.
- `GET /api/staff/settings`: staff. 200 `{ ai: { anthropicApiKey: Secret, planningModel, chatModel, fastModel }, providers: { apify: { apiKey: Secret }, googleMaps: { apiKey: Secret }, firecrawl: { apiKey: Secret }, apollo: { apiKey: Secret }, hunter: { apiKey: Secret }, zerobounce: { apiKey: Secret }, twilio: { accountSid: string | null, authToken: Secret } }, email: { host, port, username, password: Secret, tls: "starttls"|"tls"|"none", fromName, fromAddress, replyTo }, stripe: { secretKey: Secret, webhookSecret: Secret, taxEnabled: bool }, analytics: { gaMeasurementId }, ceilings: { maxCredits, maxLeads, maxActiveMinutes, maxTotalHours, maxAttempts, trialCredits }, landing: { youtubeVideoId }, support: { supportEmail } }` where `Secret = { set: bool, last4: string | null, updatedAt: string | null }`.
- `PUT /api/staff/settings/:section` (`ai|providers|email|stripe|analytics|ceilings|landing|support`): staff. Req = that section with secrets as `string` (replace), `""` (clear) or omitted (keep). 200 the section. Errors 400.
- `POST /api/staff/settings/test`: staff. Req `{ target: "anthropic"|"apify"|"googleMaps"|"firecrawl"|"apollo"|"hunter"|"zerobounce"|"twilio"|"smtp"|"stripe", to?: email }`. 200 `{ ok: bool, message: string }`.
- `GET /api/staff/audit-log?businessId&staffMemberId&action&cursor&limit=50`: staff. 200 list of `{ id, at, staff: { id, email }, business: { id, name } | null, action, targetType, targetId, details }`.

### Billing
- `GET /api/credits`: session. 200 `{ balance, reserved, available, packs: [{ id, name, credits, price: Money }], paymentsAvailable: bool }`.
- `GET /api/credits/ledger?cursor&limit`: session. 200 list of `{ id, type: "grant"|"purchase"|"reservation"|"release"|"settlement"|"adjustment", credits: int (signed), description, runId: string | null, createdAt }`.
- `POST /api/credits/checkout`: session, Owner, verified, not Acting as. Req `{ packId }`. 200 `{ checkoutUrl }`. Errors 403 `EMAIL_NOT_VERIFIED`/`ACTING_AS_FORBIDDEN`, 404, 503 `PAYMENTS_UNAVAILABLE`.
- `POST /api/webhooks/stripe`: public, raw body, `Stripe-Signature`. 200 `{ received: true }`. Errors 400 `INVALID_SIGNATURE`.
- `POST /api/staff/businesses/:id/credits`: staff. Req `{ credits: int ≠ 0 (−1,000,000..1,000,000), reason }`. 201 ledger entry. Errors 422 `INSUFFICIENT_CREDITS`.
- `GET /api/staff/credit-packs`, `POST /api/staff/credit-packs`, `PUT /api/staff/credit-packs/:id`: staff. Pack `{ id, name, credits, priceCents, active }`.

### Profile and assistant
- `GET /api/profile`: session. 200 `Profile = { businessName, description, category, address: { line1, city, state, postalCode, country: "US" }, location: { lat, lng, label } | null, deliveryRadiusMiles, currentCustomers, priceRange, website, products: [{ id, name, description }], complete: bool }`.
- `PUT /api/profile`: session. Req `Profile` without `products`, `location`, `complete`. 200 `Profile`. Errors 400, 422 `ADDRESS_NOT_FOUND`.
- `POST /api/profile/products`, `PUT /api/profile/products/:id`, `DELETE /api/profile/products/:id`: session. Product `{ name, description }`. Errors 409 `PRODUCT_IN_USE`.
- `GET /api/conversations/welcome`: session. 200 `{ id, messages: [{ id, role: "user"|"assistant", text, quickReplies: string[], createdAt }], profileComplete: bool }`.
- `POST /api/conversations/:id/messages`: session. Req `{ text }`. 200 `{ messages: Message[] (the user message and the reply), profile: Profile, profileComplete: bool, planId: string | null }` (`planId` set when the reply created a Plan). Errors 429, 503 `ASSISTANT_UNAVAILABLE` (user message kept).

### Planning
- `Plan = { id, name, goal, segments: [{ id, name, fitSignals: string[], exclusions: string[], productId }], searchArea: { label, lat, lng, radiusMiles }, guardrails: { maxCredits, maxLeads, minFitScore }, icpEdited: bool, estimate: { maxCredits, typicalCredits }, available: int, lastRun: RunSummary | null, leadsCount, createdAt, updatedAt, warnings?: string[] }`
- `POST /api/plans`: session. Req `{ goal }`. 201 `Plan`. Errors 403 `EMAIL_NOT_VERIFIED`, 422 `PROFILE_INCOMPLETE`, 429 `TOO_MANY_REQUESTS`, 503 `ASSISTANT_UNAVAILABLE`.
- `GET /api/plans`: session. 200 list of `Plan` without segments.
- `GET /api/plans/:id`, `PATCH /api/plans/:id` (any of `name`, `segments`, `searchArea: { query } | { label, lat, lng, radiusMiles }`, `guardrails`): session. 200 `Plan`. Errors 400, 404, 422 `ADDRESS_NOT_FOUND`.
- `GET /api/places/search?q`: session. 200 `{ items: [{ label, lat, lng }] }` (geocoding, ≤ 5).

### Research
- `RunSummary = { id, planId, flow: { key, version }, attempt: { current, max }, takingLonger: bool, status: "queued"|"running"|"retrying"|"completed"|"failed"|"cancelled", steps: [{ key, name, status: "pending"|"running"|"done"|"skipped"|"failed" }], startedAt, finishedAt, creditsReserved, creditsSpent, leadsDelivered, costPerLead: number | null, budgetReached, timeReached, failureReason: string | null }`
- `POST /api/plans/:id/runs`: session. 201 `RunSummary`. Errors 402 `INSUFFICIENT_CREDITS { available, required }`, 403 `EMAIL_NOT_VERIFIED`, 409 `RUN_IN_PROGRESS`, 503 `RESEARCH_UNAVAILABLE`.
- `GET /api/runs/:id`: session. 200 `RunSummary`.
- `GET /api/plans/:id/runs`: session. 200 list of `RunSummary`.
- `POST /api/runs/:id/cancel`: session. 202 `RunSummary`. Errors 409 `RUN_NOT_ACTIVE`.
- `POST /api/runs/:id/resume` (starts a new attempt): session. 202 `RunSummary`. Errors 409 `RUN_NOT_FAILED`, 402 `INSUFFICIENT_CREDITS`, 409 `RUN_IN_PROGRESS`.
- `GET /api/staff/runs?status&businessId&cursor`: staff. 200 list of `RunSummary & { business: { id, name }, planName, startedBy: "owner"|"staff", durationS, providerCostMicros }`.
- `GET /api/staff/runs/:id`: staff. 200 the above plus `steps[]` with `{ creditsSpent, durationS, checkpointBytes, error, toolCalls: [{ id, toolKey, units, millicredits, providerCostMicros, status, error, durationMs, createdAt }] }`.
- `POST /api/staff/runs/:id/resume`: staff. 202 `RunSummary`. Errors 409 `RUN_NOT_FAILED`, 402.
- `GET /api/staff/queue`: staff. 200 `{ waiting, active, failed, delayed, retrying, stalledFound, sweeperLastRunAt, workerLastSeenAt }`.
- Staff run detail (`GET /api/staff/runs/:id`) adds `attempts: [{ n, startedAt, endedAt, outcome, from: { stepKey, item }, reached: { stepKey, item }, error, handoff: { stepKey, itemsDone, itemsLeft, notes, lastError, creditsLeft, activeSecondsLeft } }]` and, per Tool call, `attempt` and `reused: bool`.
- `GET /api/staff/flows`: staff. 200 list of `{ key, name, version, isDefault, plansUsing, updatedAt }`.
- `GET /api/staff/flows/:key`: staff. 200 `Flow = { key, name, version, runSettings: { maxActiveMinutes, maxTotalHours, maxAttempts, retryWaitsMinutes: int[], workerStoppedAfterMinutes, scoreAtBudgetPct, scoreAtMinutes }, planDefaults: { maxCredits, maxLeads, minFitScore }, steps: [{ key, name, tools: string[], budgetPct, timeLimitMinutes, required }], ceilings }`.
- `PUT /api/staff/flows/:key`: staff. Req `Flow` without `version`/`ceilings`. 201 `Flow` (new version). Errors 400 (fields name the ceiling or the 100% rule), 422 `STEP_TIME_OVER_ACTIVE_TIME`.
- Site routes (HTML, server-rendered, not JSON): `GET /`, `/terms`, `/privacy`, `/acceptable-use`, `/cookies`, `/sitemap.xml`, `/robots.txt`; form posts `POST /site/signup` and `POST /site/login` (form-encoded; 303 redirect on success, re-render with errors on failure).

### Tools
- `GET /api/staff/tools`: staff. 200 `{ items: [{ key, name, provider, unit, providerCostMicrosPerUnit, creditsPerUnit, marginPct, enabled, configured, health: { calls24h, errorRate24h, lastErrorAt, lastError } }] }`.
- `PATCH /api/staff/tools/:key`: staff. Req any of `{ enabled, creditsPerUnit (0.001..10000), providerCostMicrosPerUnit (0..100,000,000) }`. 200 the Tool.

### Leads
- `LeadSummary = { id, name, category, distanceMiles, fitScore, contacts: { phone: bool, email: bool, website: bool, instagram: bool, tiktok: bool }, feedback: "good"|"not_fit"|null, runId, deliveredAt }`
- `Lead = LeadSummary & { address, contacts: [{ type: "phone"|"email"|"website"|"instagram"|"tiktok"|"yelp"|"facebook", value, label: string | null, verification: "verified"|"unverified", source: Source }], evidence: [{ fact, points: int (−30..40), source: Source }], pitch: { productId, productName, reason }, feedbackReason: string | null, planId }`
- `GET /api/plans/:id/leads?runId&minScore&feedback&q&sort=score|distance|newest&cursor&limit=50`: session. 200 `{ items: LeadSummary[], nextCursor, stats: { total, avgFitScore, verifiedPct, creditsSpent, costPerLead } }`.
- `GET /api/leads/:id`: session. 200 `Lead`.
- `PUT /api/leads/:id/feedback`: session. Req `{ value: "good"|"not_fit"|null, reason?: string ≤ 200 }`. 200 `Lead`.
- `GET /api/plans/:id/leads.csv?<same filters>`: session. 200 `text/csv`, `Content-Disposition: attachment`.

### Reporting (Staff)
- `GET /api/staff/dashboard?period=7d|30d|90d`: staff. 200 `{ period, customers: { total, newSignups: { value, previous, byDay: [{ date, count }] }, verified, active, paying, trialToPaidPct }, revenue: { packRevenue: Money, creditsGranted, creditsPurchased, creditsSpent, unspentCredits }, runs: { started, completedPct, withinLimitsPct, medianDurationS, avgCredits, failed: [{ runId, businessName, failureReason, at }] }, leads: { delivered, goodPct, verifiedPct, providerCostPerLeadCents, creditsPerLead, grossMarginPct }, plans: { noIcpEditPct }, northStar: { goodLeadsPerActiveBusinessPerWeek }, providers: [{ toolKey, spendCents, errorRatePct }], topBusinesses: [{ id, name, creditsSpent }], latestSignups: [{ id, name, ownerEmail, createdAt }] }` (each number may be `null` = no data; each headline number has `previous`).
- `GET /api/staff/businesses?q&sort=signedUp|lastActive&cursor&limit=50`: staff. 200 list of `{ id, name, ownerEmail, signedUpAt, verified, availableCredits, runs, leadsDelivered, lastActiveAt, paying, internal }`.
- `PATCH /api/staff/businesses/:id`: staff. Req `{ internal: bool }`. 200.

### External integrations
| Service | Purpose | Auth | When it's down |
|---------|---------|------|----------------|
| Anthropic | chat, extraction, plan drafting, run agent, scoring | API key (settings) | chat shows Retry; plan draft 503; run Step retries then fails → FR-20 policy |
| Google Maps Platform | Places Text Search, Geocoding | API key | Step 2 continues with Apify + OSM; geocoding 422 |
| Apify | Google Maps, Instagram, Yelp actors | API token | Step 2 continues with Places + OSM; Step 6 skipped |
| Overpass (OSM) | open places | none, 1 req/s | Step 2 continues |
| Firecrawl | website reading | API key | Step 5 skipped for failed sites |
| Apollo, Hunter | emails | API key | Step 7 skipped |
| ZeroBounce, Twilio Lookup | verification | API key / SID + token | required; contacts stay "unverified", Leads need ≥ 1 verified contact |
| Stripe | Checkout, webhooks, Tax | secret key, webhook secret | Buy disabled (503) |
| SMTP provider | all email | username/password, port 2525 | outbox retries 5×, then the email is marked failed in the back office queue view |
| Google Analytics | page views | measurement ID | no effect on the app |

## 8. Data model
| Entity | Fields (type, constraints) | Relationships | Context |
|--------|----------------------------|---------------|---------|
| businesses | id uuid PK, name varchar(120), internal bool default false, created_at, last_active_at | 1–n members | identity |
| members | id, business_id FK, email varchar(254) unique, name varchar(80), password_hash, role enum(owner), is_staff bool, email_verified_at null, totp_secret_enc varbinary null, totp_enabled_at null, created_at | | identity |
| sessions | id (sha-256 of token) PK, member_id FK, acting_as_business_id FK null, two_factor_passed bool, created_at, last_seen_at, expires_at | | identity |
| email_tokens | id, member_id, purpose enum(verify, reset), token_hash unique, expires_at, used_at null | | identity |
| login_attempts | id, email, ip, success bool, created_at; index (email, created_at), (ip, created_at) | | identity |
| settings | section varchar(32) PK, value_json json, secrets_enc json (each field ciphertext + iv + tag), updated_by, updated_at | | platform |
| audit_log | id, at, staff_member_id, business_id null, action varchar(64), target_type, target_id null, details json; index (business_id, at), (staff_member_id, at) | append-only | platform |
| analytics_events | id, name, business_id null, member_id null, properties json, at; index (name, at) | | platform |
| outbox | id, type, payload json, created_at, dispatched_at null, attempts | | shared infra |
| credit_ledger | id, business_id, type enum, credits int signed, description, run_id null, purchase_id null, idempotency_key unique null, created_by_member_id null, created_at; index (business_id, created_at) | append-only | billing |
| reservations | run_id PK, business_id, credits int, status enum(open, settled, released), created_at, closed_at | | billing |
| credit_packs | id, name, credits int, price_cents int, active bool, position | | billing |
| purchases | id, business_id, pack_id, stripe_session_id unique, stripe_event_id unique null, amount_cents, tax_cents, status enum(pending, paid), created_at, paid_at | | billing |
| business_profiles | business_id PK, description, category, address_line1, city, state, postal_code, country char(2), lat decimal(9,6), lng decimal(9,6), location_label, delivery_radius_miles decimal(5,1), current_customers, price_range, website, completed_at null, updated_at | | profile |
| products | id, business_id, name, description, created_at | | profile |
| conversations | id, business_id, kind enum(welcome), created_at | 1–n messages | assistant |
| messages | id, conversation_id, role enum(user, assistant), text, quick_replies json, created_at | | assistant |
| plans | id, business_id, name, goal, search_label, lat, lng, radius_miles decimal(4,1), max_credits, max_leads, min_fit_score, icp_edited_at null, created_at, updated_at | 1–n target_segments | planning |
| target_segments | id, plan_id, name, fit_signals json, exclusions json, product_id, position | | planning |
| research_flows | id, key, name, version int, settings json (run settings, plan defaults), steps json (incl. budgetPct, timeLimitMinutes, required), is_template bool, is_default bool, business_id null, created_by, created_at; unique (key, version) | | research |
| run_attempts | id, run_id, n int, status enum(running, completed, retryable_error, final_error, worker_stopped, cancelled), from_step, from_item, reached_step null, reached_item null, error null, lease_owner, lease_expires_at, started_at, ended_at null, active_seconds; unique (run_id, n) | n–1 research_runs | research |
| run_handoffs | run_id PK, attempt_n, step_key, items_done int, items_left int, notes varchar(2000), last_error null, credits_left, active_seconds_left, updated_at | 1–1 research_runs (current) | research |
| run_messages | id, run_id, attempt_n, step_key, role, content json, created_at (kept 90 days) | | research |
| research_runs | id, business_id, plan_id, flow_id, plan_snapshot json, status enum, started_by_member_id, started_by_staff_id null, flow_version int, flow_settings json (snapshot), attempts int, active_seconds int, next_attempt_at null, budget_reached, time_reached, failure_code null, queued_at, started_at, finished_at, credits_reserved, credits_spent, millicredits_spent bigint, provider_cost_micros bigint, leads_delivered; index (business_id, status) | 1–n run_steps | research |
| run_steps | id, run_id, step_key, position, status, attempts int, progress json (done / remaining work items, saved after every Tool call), started_at, finished_at, millicredits_spent, checkpoint json null, error null; unique (run_id, step_key) | | research |
| tools | key PK, name, provider, unit, provider_cost_micros_per_unit bigint, credits_per_unit decimal(10,3), enabled bool, max_units_per_call int | | tools |
| tool_calls | id, run_id null, step_key null, attempt_n null, reused bool, business_id, tool_key, input_hash char(64), input json, output json null (kept 90 days), units int, millicredits bigint, provider_cost_micros bigint, status enum(ok, error, skipped), error null, duration_ms, created_at; index (run_id, step_key, tool_key, input_hash), (tool_key, created_at) | | tools |
| sources | id, name, url varchar(2048) null, retrieved_at | | leads |
| prospects | id, run_id, business_id, name, address, lat, lng, category, phone_normalised, domain, place_keys json, pre_score null, data json, created_at | | leads |
| leads | id, business_id, plan_id, run_id, prospect_id, place_key, name, category, address, distance_miles, fit_score, pitch_product_id, pitch_reason, feedback enum null, feedback_reason null, feedback_at null, removed_at null, delivered_at; unique (plan_id, place_key) | 1–n lead_contacts, lead_evidence | leads |
| lead_contacts | id, lead_id, type enum, value, label null, verification enum(verified, unverified), source_id | | leads |
| lead_evidence | id, lead_id, fact varchar(300), points int, source_id, position | | leads |

Volume: < 100 Businesses, < 500 runs and < 50,000 Leads in the first 3 months. Retention: everything kept; `tool_calls` and `analytics_events` older than 13 months may be purged by a later job. No existing data.

### 8a. Demo seed data
- `owner@demo.test` / `demo1234`: Owner of "Sweet Supply Co" (Austin TX, cane sugar + powdered sugar, 3 miles), verified, 863 credits; Plan "Bakeries near Austin" with one completed run and 25 Leads built from the fake-Tool fixtures (mixed scores, Feedback on 5).
- `new@demo.test` / `demo1234`: Owner of "Clean Desk Co", verified, empty profile, 50 credits (welcome chat start).
- `low@demo.test` / `demo1234`: Owner of "Corner Coffee Roasters", complete profile, one Plan, 120 credits (AJ-4).
- `staff@demo.test` / `demo1234`: Staff, own Business "Llyner Leads (internal)" marked internal, TOTP secret `JBSWY3DPEHPK3PXP` (demo only).
- Platform settings: SMTP → Mailpit, all provider keys set to fake values, fake adapters enabled in dev and test (`TOOLS_MODE=fake`).
- Credit packs: Starter, Growth, Pro (FR-13). Tools with the seeded Rate card. Flow template "Local buyers" v1.

All names and contacts are invented; no real personal data.

## 9. Technical notes
Stack: docs/architecture/stack.md. This version adds or changes:
- **New contexts:** `platform` (Platform settings, Audit log, analytics events, email sending) and `reporting` (read-only Staff dashboard and customer list), see the context map.
- **ADR 0012:** provider keys and service credentials live encrypted in the database (Platform settings), not in env vars; only infrastructure secrets stay in env. **ADR 0013:** email over SMTP (nodemailer) configured in Platform settings, replacing the HTTP email API. **ADR 0014:** Staff two-factor and Acting as. **ADR 0015:** Docker is the only local runtime. **ADR 0016:** the public site is rendered on the server by the api at `/`; the SPA moves to `/app` (App Platform routes: `/api` and `/` → api service, `/app` → static web). **ADR 0017:** runs survive failures through attempts, handoffs and leases; limits live on the Research flow (amends ADR 0011).
- **Env vars:** `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `SETTINGS_ENCRYPTION_KEY` (32 bytes base64), `APP_URL`, `SENTRY_DSN`, `TOOLS_MODE` (`live`/`fake`; `fake` forbidden when `NODE_ENV=production`).
- **Dependencies:** `@anthropic-ai/sdk`, `bullmq`, `ioredis`, `stripe`, `nodemailer`, `otplib`, `qrcode`, `apify-client`, `bcryptjs`, `@sentry/node`, `@sentry/react`, `maplibre-gl` (map preview, OSM tiles), `csv-stringify`.
- **Ports:** `LlmClient` (Anthropic adapter + scripted fake), `Geocoder`, `ToolRunner` + one `ToolAdapter` per Tool (live + fixture fake), `EmailSender` (SMTP adapter + in-memory fake; Mailpit in dev/e2e), `PaymentGateway` (Stripe + fake), `SecretBox` (AES-256-GCM), `SettingsReader` (cached 60 s), `AuditLog`, `AnalyticsTracker`, `Clock`.
- **Worker:** `apps/api/src/worker.ts` runs queues `research-runs` (concurrency 2), `outbox` (relay every 2 s), `email`, and the run sweeper (every 30 s); heartbeat to Valkey and attempt leases renewed every 30 s.
- **Public site:** `apps/api/src/site/` renders React pages from `apps/web/src/site/` with `react-dom/server` (shared Midnight components), plus `sitemap.xml`, `robots.txt`; Vite builds the SPA with `base: '/app/'`.
- **Docker compose (dev/test):** api, worker, web (Vite), mysql, valkey, mailpit.
- **Agent prompts** live in `modules/research/application/prompts/` as versioned files; the run records the prompt version.
- **Spaces** is not used in this version (CSV is streamed).

## 10. Non-functional requirements
- NFR-1 Performance: non-AI API endpoints p95 < 300 ms at 20 req/s on the smallest App Platform instance; Lead list of 100 renders < 1 s; Staff dashboard < 1 s p95 with 50,000 Leads.
- NFR-2 Chat latency: welcome chat reply p95 < 12 s; a typing indicator shows immediately.
- NFR-3 Runs: ≥ 95% finish within 60 minutes and their budget (G-5); two runs can execute at once on one worker.
- NFR-4 Security: OWASP ASVS L1 for auth; bcryptjs cost 12; TOTP for Staff; secrets AES-256-GCM, never logged or returned; session cookie httpOnly, Secure, SameSite=Lax; Origin check; rate limits as in FR-1..5; every query scoped to the Actor's Business (tested); Stripe webhook signature verified; CSV injection prevented.
- NFR-5 Privacy: B2B public data only (ADR 0007); every contact and Evidence item has a Source; no personal data in analytics or GA.
- NFR-6 Accessibility: WCAG 2.1 AA on all new screens; every shortcut also reachable by mouse; focus visible.
- NFR-7 i18n readiness: all UI strings in `apps/web/src/shared/i18n/en.ts`; emails in `modules/platform/infrastructure/email/templates/en/`.
- NFR-10 SEO and speed: landing page Lighthouse (mobile) SEO ≥ 95, Performance ≥ 90, LCP < 2.5 s, CLS < 0.1; server render p95 < 150 ms (cached).
- NFR-11 Recovery: a stalled attempt is detected within lease + 30 s (default 5.5 min) and the next attempt starts after the flow's wait.
- NFR-8 Reliability: progress saved after every Tool call and a Checkpoint after every Step; automatic retry ×3 resumes without repeating or re-charging stored work; outbox delivery at-least-once with idempotent consumers; worker restarts don't lose runs.
- NFR-9 Cost: tests and CI never call paid APIs (ADR 0005).

## 11. Testing notes
- Fake LLM scripted per test (`LlmClient` fake returns queued responses; asserts prompt contains key facts).
- Fake Tools return recorded fixtures (30 Austin bakeries, 10 coffee shops), including error modes for AJ-5.
- Stripe: unit-test the webhook with signed payloads built with the Stripe SDK's test helper; e2e uses the fake `PaymentGateway` whose checkout URL is a local page that triggers the webhook.
- TOTP in e2e: compute the code from the seeded secret with `otplib`.
- Worker tests run the real BullMQ against Valkey in Docker; one test kills the worker mid-run and checks resume.
- Every customer endpoint gets a cross-Business test (Business A can't read B's data).

## 12. Release notes
- Migrations: all tables in §8 (fresh database). Seed production with: the Flow template, Tools and Rate card, Credit packs, Platform settings defaults (no secrets).
- Before launch: set env vars; run `staff:grant <founder email>` from the App Platform console; set up two-factor; enter Anthropic, provider, SMTP, Stripe keys in Settings and run every Test; create the Stripe webhook endpoint `https://<domain>/api/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`; review the legal page drafts and fill in `[founder's state]` and the company name.
- `/ship-requirement` must be updated for App Platform first (known gap in stack.md).
- Rollout: one environment (ADR 0018), deployed by hand after the founder approves. Founder runs 2 real runs with Stripe in test mode, then switches Stripe to live keys and opens sign-up to everyone.

## 13. Assumptions & decisions
- Staff = the "super admin" the founder asked for; one level, granted only by a server command (glossary keeps "Staff").
- Acting as works like signing in with the customer's credentials, but can't change email/password, buy credits or delete the Business. No banner, reason prompt, time limit or re-authentication in this version (founder's decision). Customers aren't notified.
- Staff two-factor sign-in is required (founder's decision).
- Owner only; no team members.
- Trial credits (50) are granted on email verification, once per Business.
- 1 credit = $0.01 at list price; packs Starter 2,500/$25, Growth 11,000/$100, Pro 30,000/$250 (Staff can change); credits never expire and are never refunded (founder's decision); Stripe Tax on (founder's decision; the founder registers the states where tax is due in Stripe).
- A run that fails with no Leads costs the customer nothing; partial runs pay real cost.
- A Lead needs Fit score ≥ minimum (default 60) and ≥ 1 verified phone or email; never delivered twice for the same Plan.
- Claude calls in the welcome chat and plan drafting aren't charged to the customer but are metered.
- One active run per Business at a time.
- Runs started by Staff while Acting as don't email the customer.
- No Removal list in this version: Llyner Leads only hands public business data to the customer and sends nothing; Staff handle any removal request by hand (founder's decision).
- Trial credits are 50 (founder's decision); a Plan's max credits default to the available balance when it's lower than the default.
- Sign-up is open to everyone.
- Runs are resumable pipelines: progress and every Tool call's output are stored, and retries resume without repeating or re-charging work (founder's request).
- Legal pages drafted by Claude, reviewed by the founder.
- SMTP details are provided by the founder and entered in Platform settings (never in the repo).
- CSV streamed, not stored in Spaces.
- SMTP replaces the HTTP email API (ADR 0013); provider keys move from env to encrypted settings (ADR 0012).
- Models default to Opus 5.5 (planning, scoring), Sonnet 5.5 (chat), Haiku 5.5 (extraction, websites); changeable in Settings.
- Public name "Llyner Leads" in all customer-facing text; code name Viper.
- One domain: public site at `/` (server-rendered), app at `/app`, API at `/api` (founder approved the recommendation).
- Landing page copy lives in the repo; the YouTube video ID is a Platform setting.
- Limits live on the Research flow, within platform ceilings (1,000 credits, 500 leads, 120 active min, 4 h total, 5 attempts); Local buyers defaults: 60 min active, 3 h total, 3 attempts, waits 1/5/15 min, worker stopped after 5 min (minimum 5; changed from 2 in the build), Step time limits 2/12/1/4/12/6/5/6/10/2 = 60 min.
- A new attempt never replays the old transcript; it starts from the handoff.

Decisions made during the build (2026-11-19 to 2026-11-20):
- Claude calls are metered as Tools through the `ToolRunner` (`claude.<role>` for 1k tokens in, `claude.<role>.out` for 1k tokens out), in runs and outside them (chat, plan drafting) (ADR 0019).
- The fast model runs the agent loop of Steps 2, 6, 7 and 8; Score & pitch keeps the planning model.
- A run that runs out of budget delivers partial results: the current Step ends, the rest is skipped and Deliver runs; it fails with `INSUFFICIENT_CREDITS` only when there is nothing to deliver.
- The welcome chat's question order drops the price range and website turns; both stay editable on the profile page.
- No Acting-as banner: the one built was removed (founder's decision); the account menu holds "Stop acting as".
- The run lease ("worker stopped after") defaults to 5 min (minimum 5), up from 2, because one provider call with retries can take about 5 min. Provider calls run outside database transactions: the call is stored as `started` first, and its outcome is stored with the handoff (ADR 0017).
- Creating a Plan needs a verified email and is capped at 30 per Business per UTC day, to protect against unverified planning-model spend.
- Waived cost stays waived: after a failed 0-Lead attempt and "Try again", only the work after the resume is charged.
- A completed run with 0 new Leads sends a "No new leads this time" email instead of "Your leads are ready".
- Staff two-factor: 10 wrong codes per Member per hour lock it for an hour (`TWO_FACTOR_LOCKED`), and a code that passed can't be reused.
- Stripe Checkout is cards only; the async payment events are handled anyway (`async_payment_succeeded` fulfils, `async_payment_failed` marks the purchase failed).
- The client IP (rate limits) comes from `do-connecting-ip`, set by the App Platform edge; a spoofed `X-Forwarded-For` is ignored.
- The SPA carries a Content-Security-Policy `<meta>`; `frame-ancestors` can't be set that way, and the App Platform static site can't send headers, so `/app` has no frame-ancestors protection. The server-rendered site sends full security headers.
- Deploy: a single environment with manual, approved deploys (ADR 0018); no staging.
- Legal pages are drafted and show a "Draft for founder review" badge until the founder approves them.

## 14. Risks & open questions
- [ ] **Launch on Monday 2026-11-23 vs this scope (now 38 FRs, 9 journeys):** the full version is 33 FRs over 6 waves. Proposed: Monday = founder-only launch (customer #1 on staging/production with Stripe in test mode) once W3 is done; open sign-up after W5. Owner: founder. Blocking: no (affects release, not the build).
- [ ] Rate card and provider costs: seeded from list prices; first 20 runs measure real cost (A-2). Owner: founder. Blocking: no.
- [ ] SMTP: founder provides the details; confirm they work from App Platform (DigitalOcean blocks some outgoing mail ports; 2525 or 587 usually work) with the Settings test on day one. Owner: founder. Blocking: no.
- [ ] Legal pages: Claude drafts; founder reviews; a lawyer's review is recommended (a no-refund policy and data-use terms are where disputes start). Owner: founder. Blocking: before charging outside customers.
- [ ] Stripe Tax: founder registers in Stripe the states where sales tax must be collected (SaaS is taxable in some US states). Owner: founder. Blocking: before the first sale.
- [ ] Removal requests: the product has no Removal list in this version. If a business asks to be excluded, Staff delete its Leads by hand; revisit before volume grows or before any EU market. Owner: founder. Blocking: no.
- [ ] 50 trial credits ≈ $0.50 of list price, enough for only a few Leads per trial run; watch trial-to-paid (A-5). Owner: founder. Blocking: no.
- [ ] Domain for `app.<domain>`. Owner: founder. Blocking: before production deploy.
- [ ] Apify actor choice (exact actors and their pricing) for Maps, Instagram, Yelp. Owner: WP-9 agent proposes, founder approves. Blocking: no.

## 15. Change log
| Version | Date | Change |
|---------|------|--------|
| 0.1 | 2026-11-19 | Initial draft (includes founder answers: 50 trial credits, no refunds, open sign-up, no Removal list, resumable runs, Stripe Tax, legal pages) |
| 0.2 | 2026-11-19 | Approved. Public landing page with sign-up/log-in card and SEO (FR-34, FR-35); app moved to `/app`; run attempts with handoff, lease and sweeper (FR-36); Research flow settings for Staff with platform ceilings (FR-37); "taking longer" message (FR-38); AJ-8, AJ-9; Docker-only local runtime; mocks linked in §6b |
| 0.3 | 2026-11-20 | Built (W0–W5). Build decisions recorded in §13 and §17: Plan creation needs a verified email and is capped at 30/day; two-factor lock and code replay guard; cards-only Checkout with async payment events; "No new leads" email; waived cost stays waived; partial delivery on budget exhaustion; lease default 5 min and seeded Step time limits; fast model on Steps 2, 6–8; chat drops the price and website turns. AJ-5, AJ-7 and AJ-9 wording fixed to match the tested behaviour |
| 0.4 | 2026-11-20 | FR-9 completed: the SPA reads `GET /api/public/config` (now `Cache-Control: public, max-age=60`) and sends GA page views with the path only; the SPA CSP allows Google's tag. Removed from Deferred |

## 16. Execution plan
| Wave | Package | Title | Model | Depends on | FRs / AJs |
|------|---------|-------|-------|------------|-----------|
| W0 | WP-0a | Scaffold monorepo, Docker (api, worker, web, mysql, valkey, mailpit), CI | sonnet | — | — |
| W0 | WP-0b | Contracts, migrations, table types, module skeletons, seed skeleton, dependencies, outbox | opus | WP-0a | all |
| W0 | WP-0c | Midnight UI kit, app shell (rail, header, account menu), i18n file, routes | sonnet | WP-0b | — |
| W1 | WP-1 | identity module | opus | W0 | FR-1–6 |
| W1 | WP-2 | platform module (settings, SecretBox, audit, analytics, SMTP EmailSender) | opus | W0 | FR-7–9 |
| W1 | WP-3 | billing module (ledger, trial, Stripe, packs, grants) | opus | W0 | FR-10–13 |
| W1 | WP-4 | web: auth, two-factor, credits, legal pages (drafts) | sonnet | W0 | FR-1–5, 10, 12, 33 |
| W2 | WP-5 | profile + assistant modules (welcome chat, LlmClient, Geocoder) | opus | W1 | FR-14, 15 |
| W2 | WP-6 | planning module (plan drafting, edits, estimate) | opus | W1 | FR-16, 17 |
| W2 | WP-7 | web: chat, profile, plans | sonnet | W1 | FR-14–17 |
| W2 | WP-8 | web back office part 1 (settings, audit log, packs) + spec AJ-3 | sonnet | W1 | FR-7, 8, 13 · AJ-3 |
| W3 | WP-9 | tools module (catalog, Rate card, ToolRunner, adapters + fixtures) | opus | W2 | FR-23, 24 |
| W3 | WP-10 | research module (flow and its settings, worker, agent loop, attempts, handoff, lease and sweeper, guardrails, settlement, emails) | opus | W2 | FR-18–22, 36–38 |
| W3 | WP-11 | leads module (merge, qualify, list, feedback, CSV) | opus | W2 | FR-25–28 |
| W3 | WP-12 | spec AJ-1 | sonnet | W2 | AJ-1 |
| W4 | WP-13 | web: working screen, lead list + detail, feedback, CSV | sonnet | W3 | FR-21, 26–28 |
| W4 | WP-14 | reporting module (dashboard, customer list) | opus | W3 | FR-30, 31 |
| W4 | WP-15 | web back office part 2 (dashboard, customers + Act as, runs, tools, research flows) | sonnet | W3 | FR-6, 23, 30–32, 37 |
| W4 | WP-17 | public site: server-rendered landing and legal pages, sign-up/log-in card, SEO | opus | W3 | FR-33–35 |
| W5 | WP-16 | specs AJ-2, AJ-4 to AJ-9 | sonnet | W4 | AJ-2, 4–9 |
| W5 | WP-R | hardening and review | opus | WP-16 | all |

| Wave | Demo: what you can see or try | Journeys unlocked |
|------|-------------------------------|-------------------|
| W0 | `./dev up` starts api, worker, web, mysql, valkey, mailpit; `/api/health` green; the Midnight shell renders with placeholder pages | — |
| W1 | Sign up, verify from Mailpit, see 50 credits; log in as Staff with a TOTP code; buy a pack with the fake Stripe | (AJ-3 backend) |
| W2 | Welcome chat builds the profile with the fake LLM (or the real one with a key); goal → Plan with chips and map; Staff edit Settings, send a test email, see the Audit log | AJ-3 |
| W3 | Start a run from a Plan; the worker runs the flow with fake Tools (or live keys); Leads in the DB; emails in Mailpit; settlement in the ledger | AJ-1 |
| W4 | The whole customer app: working screen, lead list and detail, feedback, CSV; back office dashboard, customers, Act as, runs, tools, research flows; the public landing page at `/` | — |
| W5 | Every journey walked by hand and by Playwright; review findings fixed | AJ-2, AJ-4 to AJ-9 |

```yaml
execution:
  orchestrator_model: opus
  waves:
    - id: W0
      name: Foundation
      parallel: false
      demo: "`./dev up` starts api, worker, web, mysql, valkey, mailpit; /api/health green; Midnight shell renders"
      journeys: []
      packages:
        - id: WP-0a
          title: Scaffold monorepo, Docker, CI
          model: sonnet
          owns: ["dev", "*.json", "*.ts", "*.js", "Dockerfile", "docker-compose*.yml", ".github/**", "scripts/**", "apps/*/*.json", "apps/*/*.ts", "apps/api/Dockerfile", "apps/api/src/main.ts", "apps/api/src/worker.ts", "apps/api/src/app.ts", "apps/api/src/shared/**", "e2e/playwright.config.ts", "e2e/fixtures.ts"]
          depends_on: []
          done_when: ["./dev lint, typecheck, test, e2e (smoke) and build pass on a machine with only Docker", "worker entry boots and connects to Valkey", "mailpit reachable in compose"]
        - id: WP-0b
          title: Contracts, migrations, table types, module skeletons, seed skeleton, dependencies, outbox
          model: opus
          requirements: all
          owns: ["packages/contracts/**", "apps/api/migrations/**", "apps/api/src/modules/*/infrastructure/tables.ts", "apps/api/src/modules/*/index.ts", "apps/api/src/shared/infrastructure/outbox/**", "apps/api/src/shared/infrastructure/db/schema.ts", "apps/web/src/features/*/index.ts", "apps/api/src/scripts/**", "package.json", "apps/*/package.json", "package-lock.json"]
          dependencies: ["@anthropic-ai/sdk", "bullmq", "ioredis", "stripe", "nodemailer", "otplib", "qrcode", "apify-client", "bcryptjs", "@sentry/node", "@sentry/react", "maplibre-gl", "csv-stringify"]
          depends_on: [WP-0a]
          done_when: ["a contract exists for every §7 endpoint", "migrations create every §8 table", "modules identity, platform, billing, profile, assistant, planning, research, tools, leads, reporting have skeletons", "./dev test green"]
        - id: WP-0c
          title: Midnight UI kit, app shell, i18n, route placeholders
          model: sonnet
          owns: ["apps/web/src/shared/ui/**", "apps/web/src/shared/i18n/**", "apps/web/src/app/**", "apps/web/src/styles/**"]
          depends_on: [WP-0b]
          done_when: ["DESIGN.md tokens in Tailwind theme", "components from DESIGN.md component table exist with tests", "shell with rail, header, account menu renders every §6b route as a placeholder"]
    - id: W1
      name: Accounts, platform and credits
      parallel: true
      demo: "Sign up, verify from Mailpit, see 50 credits; Staff log in with TOTP; buy a pack with the fake Stripe"
      journeys: []
      packages:
        - id: WP-1
          title: identity module
          model: opus
          requirements: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6]
          owns: ["apps/api/src/modules/identity/**"]
          depends_on: [WP-0b]
          done_when: ["each FR has domain, application, repository and HTTP tests", "Actor resolution with Acting as and its restrictions tested", "staff:grant, staff:revoke, staff:reset-2fa commands work"]
        - id: WP-2
          title: platform module
          model: opus
          requirements: [FR-7, FR-8, FR-9]
          owns: ["apps/api/src/modules/platform/**"]
          depends_on: [WP-0b]
          done_when: ["secrets encrypted and never returned", "settings tests for every target with fakes", "SMTP adapter sends to Mailpit in an integration test", "audit hook records Acting-as writes"]
        - id: WP-3
          title: billing module
          model: opus
          requirements: [FR-10, FR-11, FR-12, FR-13]
          owns: ["apps/api/src/modules/billing/**"]
          depends_on: [WP-0b]
          done_when: ["reserve/settle/release with concurrency test", "webhook idempotency test", "trial grant idempotent"]
        - id: WP-4
          title: web auth, two-factor, credits, legal pages
          model: sonnet
          requirements: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-10, FR-12, FR-33]
          owns: ["apps/web/src/features/auth/**", "apps/web/src/features/credits/**", "apps/web/src/features/legal/**", "apps/web/src/content/**"]
          depends_on: [WP-0c]
          done_when: ["pages tested with Testing Library and MSW", "legal page drafts written for founder review"]
    - id: W2
      name: Profile, chat and plans
      parallel: true
      demo: "Welcome chat builds the profile; goal → Plan with chips and map; Staff edit Settings, test email, Audit log"
      journeys: [AJ-3]
      packages:
        - id: WP-5
          title: profile and assistant modules
          model: opus
          requirements: [FR-14, FR-15]
          owns: ["apps/api/src/modules/profile/**", "apps/api/src/modules/assistant/**"]
          depends_on: [WP-1, WP-2]
          done_when: ["scripted fake LLM conversation fills the profile", "LLM timeout keeps the message"]
        - id: WP-6
          title: planning module
          model: opus
          requirements: [FR-16, FR-17]
          owns: ["apps/api/src/modules/planning/**"]
          depends_on: [WP-1, WP-2]
          done_when: ["plan drafting from scripted LLM", "ICP edit tracking", "estimate rule tested"]
        - id: WP-7
          title: web chat, profile, plans
          model: sonnet
          requirements: [FR-14, FR-15, FR-16, FR-17]
          owns: ["apps/web/src/features/assistant/**", "apps/web/src/features/profile/**", "apps/web/src/features/plans/**"]
          depends_on: [WP-4]
          done_when: ["pages tested with MSW", "map preview renders"]
        - id: WP-8
          title: web back office part 1 and spec AJ-3
          model: sonnet
          requirements: [FR-7, FR-8, FR-13]
          owns: ["apps/web/src/features/backoffice/settings/**", "apps/web/src/features/backoffice/audit/**", "apps/web/src/features/backoffice/packs/**", "e2e/aj-3-*.spec.ts"]
          depends_on: [WP-4]
          done_when: ["settings forms never display secrets", "AJ-3 spec passes"]
    - id: W3
      name: Research engine
      parallel: true
      demo: "Start a run; the worker runs the flow with fake Tools; Leads in the DB; emails in Mailpit; settlement in the ledger"
      journeys: [AJ-1]
      packages:
        - id: WP-9
          title: tools module
          model: opus
          requirements: [FR-23, FR-24]
          owns: ["apps/api/src/modules/tools/**"]
          depends_on: [WP-2]
          done_when: ["every adapter tested against a recorded fixture", "ToolRunner metering and budget checks tested", "fake mode serves fixtures"]
        - id: WP-10
          title: research module
          model: opus
          requirements: [FR-18, FR-19, FR-20, FR-21, FR-22, FR-36, FR-37, FR-38]
          owns: ["apps/api/src/modules/research/**"]
          depends_on: [WP-3, WP-6]
          done_when: ["full run with fake Tools delivers expected Leads", "crash-resume tests between Steps and mid-Step (no repeated or re-charged Tool calls)", "automatic retry and Owner/Staff resume", "guardrail and failure-policy settlement tests"]
        - id: WP-11
          title: leads module
          model: opus
          requirements: [FR-25, FR-26, FR-27, FR-28]
          owns: ["apps/api/src/modules/leads/**"]
          depends_on: [WP-1]
          done_when: ["merge/dedupe and qualification rules tested", "CSV injection test"]
        - id: WP-12
          title: spec AJ-1
          model: sonnet
          owns: ["e2e/aj-1-*.spec.ts"]
          depends_on: [WP-5, WP-7]
          done_when: ["AJ-1 spec passes"]
    - id: W4
      name: Results and back office
      parallel: true
      demo: "Whole customer app and back office: working screen, lead list, feedback, CSV; dashboard, customers, Act as, runs, tools, research flows; landing page at /"
      journeys: []
      packages:
        - id: WP-13
          title: web working screen, leads, feedback, CSV
          model: sonnet
          requirements: [FR-21, FR-26, FR-27, FR-28]
          owns: ["apps/web/src/features/research/**", "apps/web/src/features/leads/**"]
          depends_on: [WP-10, WP-11]
          done_when: ["J/K/G/N/Esc shortcuts tested", "empty states tested"]
        - id: WP-14
          title: reporting module
          model: opus
          requirements: [FR-30, FR-31]
          owns: ["apps/api/src/modules/reporting/**"]
          depends_on: [WP-3, WP-9, WP-10, WP-11]
          done_when: ["every dashboard number tested against seeded fixtures", "dashboard p95 < 1 s with 50,000 Leads"]
        - id: WP-15
          title: web back office part 2
          model: sonnet
          requirements: [FR-6, FR-23, FR-30, FR-31, FR-32, FR-37]
          owns: ["apps/web/src/features/backoffice/dashboard/**", "apps/web/src/features/backoffice/customers/**", "apps/web/src/features/backoffice/runs/**", "apps/web/src/features/backoffice/tools/**", "apps/web/src/features/backoffice/flows/**"]
          depends_on: [WP-8]
          done_when: ["pages tested with MSW", "Act as and stop flow tested", "flow settings validation shown inline"]
        - id: WP-17
          title: public site (server-rendered landing and legal pages, sign-up/log-in card, SEO)
          model: opus
          requirements: [FR-33, FR-34, FR-35]
          owns: ["apps/api/src/site/**", "apps/web/src/site/**", "apps/web/src/content/**"]
          depends_on: [WP-1, WP-3]
          done_when: ["HTML of / contains headline, prices and JSON-LD without JavaScript", "no-JS sign-up and log-in work", "Lighthouse targets of NFR-10 met in Docker"]
    - id: W5
      name: Journeys and hardening
      parallel: false
      demo: "Every journey walked by hand and by Playwright; review findings fixed"
      journeys: [AJ-2, AJ-4, AJ-5, AJ-6, AJ-7, AJ-8, AJ-9]
      packages:
        - id: WP-16
          title: specs AJ-2, AJ-4 to AJ-9
          model: sonnet
          owns: ["e2e/aj-2-*.spec.ts", "e2e/aj-4-*.spec.ts", "e2e/aj-5-*.spec.ts", "e2e/aj-6-*.spec.ts", "e2e/aj-7-*.spec.ts", "e2e/aj-8-*.spec.ts", "e2e/aj-9-*.spec.ts"]
          depends_on: [WP-13, WP-14, WP-15, WP-17]
          done_when: ["each listed AJ has a passing spec"]
        - id: WP-R
          title: Hardening and review
          model: opus
          owns: []
          depends_on: [WP-16]
          done_when: ["security checklist passes", "every FR and AJ maps to a passing test", "NFR-1 and NFR-3 measured"]
```

## 17. Implementation notes
Built 2026-11-19 to 2026-11-20 by /build-requirement on branch `feat/first-version`. Paths: `api/` = `apps/api/src/modules/`, `web/` = `apps/web/src/features/`, `contracts/` = `packages/contracts/src/`. "e2e" names the journey spec that also covers the FR; "unit only" means no e2e journey exercises it.

### FR → test files
| FR | Test files |
|----|-----------|
| FR-1 Sign up | api/identity/domain/domain.test.ts, application/sign-up-and-verify.test.ts, http/identity.http.test.ts, infrastructure/kysely-repositories.int.test.ts; `apps/api/src/shared/http/client-ip.test.ts` (rate-limit IP); web/auth/test/signup.test.tsx; contracts/identity.test.ts · e2e AJ-1, AJ-8 |
| FR-2 Verify email | api/identity/application/sign-up-and-verify.test.ts, http/identity.http.test.ts, kysely-repositories.int.test.ts; web/auth/test/email-and-password.test.tsx · e2e AJ-1 |
| FR-3 Log in / out | api/identity/application/log-in-and-password.test.ts, http/identity.http.test.ts, http/identity.http.int.test.ts; web/auth/test/login.test.tsx · e2e AJ-6, AJ-8 |
| FR-4 Password reset | api/identity/application/log-in-and-password.test.ts, http/identity.http.test.ts, infrastructure/security-adapters.test.ts; web/auth/test/email-and-password.test.tsx · unit only |
| FR-5 Staff two-factor | api/identity/application/staff.test.ts (incl. `TWO_FACTOR_LOCKED`, code reuse), infrastructure/security-adapters.test.ts, http/identity.http.int.test.ts (TOTP cookie flow); web/auth/test/two-factor.test.tsx · e2e AJ-6 |
| FR-6 Acting as | api/identity/application/staff.test.ts, domain/domain.test.ts, http/identity.http.test.ts; web/backoffice/customers/test/customers.test.tsx; `apps/web/src/app/shell.test.tsx` (no banner, menu item) · e2e AJ-6 |
| FR-7 Audit log | api/platform/application/audit-log.test.ts, domain/audit-action.test.ts, http/audit-trail.test.ts, infrastructure/platform-repositories.int.test.ts; `apps/api/src/composition.int.test.ts`; web/backoffice/audit/test/audit.test.tsx · e2e AJ-6, AJ-7 |
| FR-8 Platform settings | api/platform/domain/settings.test.ts, application/settings-use-cases.test.ts, settings-reader.test.ts, infrastructure/secret-box.test.ts, connectivity/provider-checks.test.ts, connectivity/service-checks.test.ts, smtp-email-sender.test.ts, smtp-mailpit.int.test.ts; web/backoffice/settings/test/settings.test.tsx · e2e AJ-7 |
| FR-9 Analytics | Server events: api/platform/domain/event-properties.test.ts, platform-repositories.int.test.ts (DbAnalyticsTracker). GA page views on the public site: `apps/api/src/site/site.http.test.ts`, `apps/web/src/site/client.test.ts`. GA page views inside the SPA (`/app`; path only, none on back-office routes or while Acting as): `apps/web/src/app/analytics.test.tsx`, `apps/web/src/shared/analytics/ga.test.ts`; public config: api/platform/http/platform.routes.test.ts, application/settings-use-cases.test.ts, contracts/platform.test.ts · unit only |
| FR-10 Credit wallet | api/billing/domain/domain.test.ts, application/billing.test.ts, http/billing.routes.test.ts, infrastructure/kysely-billing.int.test.ts (concurrency); web/credits/test/credits.test.tsx · e2e AJ-3, AJ-4 |
| FR-11 Trial credits | api/billing/application/billing.test.ts, infrastructure/kysely-billing.int.test.ts, billing-worker.int.test.ts (event delivered twice) · e2e AJ-1 |
| FR-12 Stripe packs | api/billing/application/billing.test.ts (webhook ×3, async events), infrastructure/stripe-payment-gateway.test.ts (signed payloads, cards only), http/billing.routes.test.ts; web/credits/test/credits.test.tsx · e2e AJ-3 |
| FR-13 Grants and packs | api/billing/application/billing.test.ts, domain/domain.test.ts, http/billing.routes.test.ts; web/backoffice/packs/test/packs.test.tsx, customers/test/customers.test.tsx · unit only |
| FR-14 Welcome chat | api/assistant/domain/welcome-flow.test.ts, application/welcome-chat.test.ts, http/assistant.routes.test.ts, infrastructure/conversation-repositories.int.test.ts; api/profile/application/profile-use-cases.test.ts; api/tools/application/tool-catalog.test.ts (LlmUsageMeter); `apps/api/src/shared/infrastructure/llm/*.test.ts`; web/assistant/test/assistant.test.tsx · e2e AJ-1, AJ-8 |
| FR-15 Edit profile | api/profile/domain/domain.test.ts, application/profile-use-cases.test.ts, http/profile.routes.test.ts, infrastructure/kysely-profile.int.test.ts; web/profile/test/profile.test.tsx · unit only |
| FR-16 Create a Plan | api/planning/domain/domain.test.ts, application/planning.test.ts (verified email, 30/day), http/planning.routes.test.ts, infrastructure/kysely-plans.int.test.ts; `apps/api/src/shared/infrastructure/llm/fake-plan-draft.test.ts`; web/plans/test/plans.test.tsx · e2e AJ-2 |
| FR-17 Edit Plan, estimate | api/planning/domain/domain.test.ts, application/planning.test.ts, http/planning.routes.test.ts, kysely-plans.int.test.ts; web/plans/test/plans.test.tsx, circle.test.ts · e2e AJ-2, AJ-4 |
| FR-18 Start a run | api/research/application/runs.test.ts, http/research.routes.test.ts, infrastructure/research-workers.int.test.ts; api/billing/application/billing.test.ts (reservation); web/plans/test/plans.test.tsx (402 dialog) · e2e AJ-2, AJ-4 |
| FR-19 Local buyers flow | api/research/application/full-run.test.ts, attempts.test.ts (crash after Step 5, mid-Step 12 of 30), infrastructure/kysely-research-store.int.test.ts, research-workers.int.test.ts, tools-compat.int.test.ts; api/leads/domain/domain.test.ts (merge); api/tools/application/tool-runner.test.ts (stored-call reuse); `apps/api/src/research-prospects.test.ts` · e2e AJ-2, AJ-9 |
| FR-20 Guardrails, settlement | api/research/application/guardrails.test.ts (80%, partial delivery, TIME_LIMIT, 136,200 → 137), runs.test.ts (waived cost), domain/domain.test.ts; api/billing/domain/domain.test.ts, application/billing.test.ts; api/tools/application/tool-runner.test.ts · e2e AJ-2, AJ-5 |
| FR-21 Working screen, cancel | api/research/application/runs.test.ts, http/research.routes.test.ts; web/research/test/run-page.test.tsx · e2e AJ-2, AJ-5 |
| FR-22 Run emails | api/research/application/run-emails.test.ts (incl. "No new leads", Staff-started), infrastructure/kysely-research-store.int.test.ts · e2e AJ-2, AJ-5 (Mailpit) |
| FR-23 Tools, Rate card, metering | api/tools/domain/domain.test.ts, application/tool-runner.test.ts, tool-catalog.test.ts, http/tools.routes.test.ts, infrastructure/kysely-tool-repositories.int.test.ts; web/backoffice/tools/test/tools.test.tsx · e2e AJ-7 |
| FR-24 Provider adapters | api/tools/infrastructure/adapters/adapters.test.ts (recorded fixtures), fake/fake-adapters.test.ts, fake/redis-fault-store.int.test.ts · unit only (e2e uses fake mode) |
| FR-25 Qualification, delivery | api/leads/domain/domain.test.ts, application/leads.test.ts, infrastructure/kysely-leads.int.test.ts; api/research/application/full-run.test.ts · e2e AJ-2 |
| FR-26 Lead list, detail | api/leads/application/leads.test.ts, views.test.ts, http/leads.routes.test.ts; web/leads/test/leads.test.tsx (J/K/Esc, empty states) · e2e AJ-2 |
| FR-27 Feedback | api/leads/domain/domain.test.ts, http/leads.routes.test.ts; web/leads/test/leads.test.tsx (G/N, reasons) · e2e AJ-2 |
| FR-28 CSV export | api/leads/domain/domain.test.ts (CSV injection), http/leads.routes.test.ts; web/leads/test/leads.test.tsx · e2e AJ-2 |
| FR-29 Removal list | deferred, not built |
| FR-30 Staff dashboard | api/reporting/domain/domain.test.ts, application/dashboard.test.ts, http/reporting.routes.test.ts, infrastructure/reporting-mysql.int.test.ts, dashboard-performance.int.test.ts (51,040 Leads, p95 156/183 ms); web/backoffice/dashboard/test/dashboard.test.tsx · e2e AJ-6 |
| FR-31 Customer list | api/reporting/application/customers.test.ts, http/reporting.routes.test.ts, reporting-mysql.int.test.ts; web/backoffice/customers/test/customers.test.tsx · e2e AJ-6 |
| FR-32 Runs monitor | api/research/application/runs.test.ts (Staff resume), http/research.routes.test.ts; web/backoffice/runs/test/runs.test.tsx · e2e AJ-5, AJ-9 |
| FR-33 Legal pages | web/legal/legal-content.test.ts (no refunds, never expire, draft badge); `apps/web/src/site/markdown.test.ts`, `pages.test.ts`; `apps/api/src/site/site.http.test.ts` · unit only |
| FR-34 Landing page | `apps/api/src/site/site.http.test.ts` (no-JS HTML, prices, JSON-LD, cache, sitemap/robots, CSP); `apps/web/src/site/pages.test.ts`, `client.test.ts`, `tokens.test.ts` · e2e AJ-8 (incl. NFR-10 vitals) |
| FR-35 Landing card | `apps/api/src/site/site.http.test.ts`; `apps/web/src/site/pages.test.ts`, `client.test.ts` · e2e AJ-8 (JS on and JS off) |
| FR-36 Attempts, handoff | api/research/application/attempts.test.ts, domain/domain.test.ts, infrastructure/bullmq.test.ts, research-workers.int.test.ts, kysely-research-store.int.test.ts; api/tools/application/tool-runner.test.ts (started row); web/backoffice/runs/test/runs.test.tsx · e2e AJ-9 |
| FR-37 Flow settings | api/research/domain/domain.test.ts, application/flows.test.ts (ceilings, 100%, step time ≤ active time), http/research.routes.test.ts; web/backoffice/flows/test/flows.test.tsx · unit only |
| FR-38 Taking longer | api/research/application/attempts.test.ts, domain/domain.test.ts; web/research/test/run-page.test.tsx · e2e AJ-9 |

Every module also has contract tests in `packages/contracts/src/*.test.ts`. Rough size (counted from the source, not a run): about 890 api, 360 web and 50 contract test cases in 131 files, plus 12 Playwright tests (9 journeys, AJ-8 ×3 incl. NFR-10, smoke ×3).

### AJ → Playwright specs
| Journey | Spec |
|---------|------|
| AJ-1 | `e2e/aj-1-sign-up-and-describe.spec.ts` |
| AJ-2 | `e2e/aj-2-goal-to-leads.spec.ts` |
| AJ-3 | `e2e/aj-3-buy-credit-pack.spec.ts` |
| AJ-4 | `e2e/aj-4-not-enough-credits.spec.ts` |
| AJ-5 | `e2e/aj-5-failed-run-is-free.spec.ts` (Places, Apify Maps and Overpass fail) |
| AJ-6 | `e2e/aj-6-staff-act-as.spec.ts` |
| AJ-7 | `e2e/aj-7-configure-platform.spec.ts` (four Audit log entries) |
| AJ-8 | `e2e/aj-8-landing-to-chat.spec.ts`: a JavaScript-on test, a JavaScript-off test (no-JS card, used email opens Log in), and an NFR-10 vitals check |
| AJ-9 | `e2e/aj-9-run-survives-worker-crash.spec.ts` |

Shared helpers: `e2e/fixtures.ts`, `e2e/journeys.ts`, `e2e/global-setup.ts`. The full suite takes about 15 minutes.

### Waves and commits
| Wave | Packages | Commit |
|------|----------|--------|
| W0 Foundation | WP-0a, WP-0b, WP-0c | `5dc2944` |
| W1 Accounts, platform and credits | WP-1, WP-2, WP-3, WP-4 | `f1f8203` (prep: `25bb59e`) |
| W2 Profile, chat and plans | WP-5, WP-6, WP-7, WP-8 | `f08de1b` (prep: `c3ea805`) |
| W3 Research engine | WP-9, WP-10, WP-11, WP-12 | `801d752` |
| W4 Results, back office, public site | WP-13, WP-14, WP-15, WP-17 | `d85b089` |
| Deploy setup (App Platform, single environment) | — | `ba53817` |
| W5 Journeys and hardening | WP-16, WP-R | not committed yet |

Sign-off: the founder chose autopilot, so there were no per-wave demos or sign-offs. The founder reviews the whole build before `/ship-requirement`.

### Decisions made during the build
Recorded in §13 ("Decisions made during the build"), with the matching FR text updated: Claude metered as Tools (ADR 0019); fast model on Steps 2, 6, 7, 8; partial delivery when the budget runs out; chat drops the price and website turns; no Acting-as banner; lease default 5 min (minimum 5) and seeded Step time limits 2/12/1/4/12/6/5/6/10/2 = 60 min, with provider calls outside transactions (ADR 0017 amended); Plan creation needs a verified email, 30 per Business per day; waived cost stays waived; "No new leads this time" email; two-factor lock and code replay guard; cards-only Checkout with async payment events; client IP from `do-connecting-ip`; SPA CSP meta without frame-ancestors; single environment with manual approved deploys (ADR 0018); legal drafts with a "Draft for founder review" badge.

### Deferred and known items
- Lighthouse (NFR-10, FR-34) isn't run; AJ-8 checks LCP and CLS in Playwright only.
- The Audit log's Target column cuts long targets short (Tool keys show truncated; full value on hover).
- Apify actors (`compass/crawler-google-places`, `apify/instagram-profile-scraper`, `tri_angle/yelp-scraper`) need the founder's approval (§14).
- MySQL TLS doesn't verify the server certificate.
- No staging environment (ADR 0018).
- No `frame-ancestors` on `/app` (static site can't send headers).
- The e2e suite takes about 15 minutes.
- Smaller follow-ups still open from the build log: the fake agent's Score & pitch Evidence always cites the Google Maps Source; leads `ProspectStore` writes commit outside the handoff transaction (safe through idempotent merge); the Working screen invalidates the plans feature's `['plans']` query key directly; `RunCosts.creditsSpentForPlan` is built in composition rather than owned by research; the Staff run detail shows its limits line only while the run's flow version is still the current one (the run's settings snapshot isn't in the contract); `shared/api/me.test.ts` timeout test flaked once under load.
