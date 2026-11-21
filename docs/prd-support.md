# PRD: Support tickets

| Field   | Value |
|---------|-------|
| Status  | Draft |
| Version | 0.2 |
| Date    | 2026-11-21 |
| Persona | Sam, Maria and team members (customers); Staff (the founder) |
| Tests assumption | None directly. Supports A-5 (trial-to-paid: a stuck trial customer who can't reach anyone won't buy) and A-1 (tickets about wrong leads are direct quality evidence) |

## 1. Overview
A **Help** area in the customer app (`/app/support`) where any Member opens a **Ticket** to ask Llyner Leads for help, follows the conversation and closes it, and a **Support desk** in the back office (`/app/staff/support`) where Staff work the **Waiting queue**: take a Ticket, reply, ask the customer something, leave **Internal notes**, jump into Acting as, and close it. A Ticket can be linked to a Research run; "Report a problem" on a failed run or a Lead list opens one with the run already attached. Every reply and close reaches the other side by email. The desk measures time to first reply and time to close so the founder can keep the support promise (first reply within 4 business hours).

## 2. Problem
There is no way to ask for help inside Llyner Leads. A customer whose run fails or whose leads look wrong has to find an email address on the legal pages and write to the founder's personal inbox, with no Business, no run and no category attached. The founder then searches Customers, guesses the Business, uses Acting as and replies from a personal mailbox. Nothing records who asked, who answered or how long it took; other Members of the Business can't see the conversation; and questions get lost. For a trial customer (A-5), an unanswered question is a lost sale.

## 3. Goals & success metrics
- G-1: Customers get a fast first answer. Metric: median time from `ticket_opened` to the first Staff reply < 4 business hours (Mon–Fri 09:00–17:00 US Central), measured over each rolling 30 days from the first month after launch.
- G-2: Problems get resolved. Metric: ≥ 90% of Tickets opened in a 30-day window are closed within 3 calendar days of opening.
- G-3: Support happens in the product. Metric: 100% of customer support conversations in December 2026 are Tickets (the founder forwards any stray email into a Ticket by hand and counts it).

### Non-goals
- Attachments and screenshots (Spaces isn't used yet).
- Replying by email (needs inbound mail); customers and Staff reply in the app.
- Satisfaction ratings, canned replies, a help centre or suggested articles.
- Priorities, SLA timers, auto-close of tickets waiting on the customer.
- Credit adjustments from a Ticket (they stay in billing through the ledger, ADR 0009).
- A public "Contact us" form for people who can't sign in (the site footer shows the support email).
- Live chat; MCP tools for the desk.

## 3a. Measurement
Server events go to `analytics_events` through the `AnalyticsTracker` port. No message text or personal data in properties; ids only.

| Event | When it fires | Properties | Proves |
|-------|---------------|------------|--------|
| `ticket_opened` | FR-2 succeeds | ticket_number, business_id, category, has_run (bool), source (`help`/`run`/`leads`) | G-1, G-2, G-3 |
| `ticket_replied` | FR-4 or FR-9 adds a reply | ticket_number, by (`staff`/`customer`), minutes_since_last, is_first_staff_reply (bool), business_minutes_to_first_reply (int, only when is_first_staff_reply) | G-1 |
| `ticket_status_changed` | any status change (FR-4, 5, 8, 9) | ticket_number, from, to, by (`staff`/`customer`/`system`) | G-2 |
| `ticket_closed` | status becomes `closed` | ticket_number, by, minutes_open, staff_replies, customer_replies | G-2 |
| `ticket_reopened` | a reply moves a closed Ticket back (FR-4, FR-9) | ticket_number, by, days_since_closed | G-2 |
| `support_desk_viewed` | `GET /api/staff/support/tickets` returns | view, waiting_count | engagement |

## 4. Users & permissions
| Role | Can | Cannot |
|------|-----|--------|
| Owner | Open Tickets; see, reply to and close **every** Ticket of their Business | See other Businesses' Tickets; see Internal notes; assign or change status other than closing |
| Member (not Owner) | Open Tickets; see, reply to and close **only the Tickets they opened** | See other Members' Tickets; anything an Owner can't |
| Staff (two-factor passed) | Everything on the Support desk: list, read (incl. Internal notes), take, assign, set status, reply, reply and wait, note, close, reopen within 30 days, Open as this Business | Edit or delete any message; open Tickets for a customer; reply on a Ticket closed > 30 days ago |
| Staff while Acting as | In the customer app: read the Business's Tickets as the Owner would see them (read-only). Staff endpoints are unaffected by Acting as | Open, reply to or close a Ticket in the customer app (403 `NOT_WHILE_ACTING_AS`) |
| Not signed in | Nothing (401) | — |

## 5. Scope
### Cut line (smallest shippable version)
- Help in the app nav (rail + 5th mobile tab) → Your tickets with Open / Closed / All filters.
- New ticket: category (5 fixed), subject, message, optional linked run from the last 90 days; Business, Member, page and credit balance attached automatically.
- "Report a problem" on a failed run and on a Lead list, run pre-linked.
- Ticket thread for the Member: replies, status, close; a reply within 30 days of closing reopens it.
- Statuses `open` → `in_progress` → `waiting_on_customer` → `closed`, customer labels "Open", "We're on it", "Waiting on you", "Closed".
- Limits: 5 open Tickets per Business; 10 new Tickets per Member per hour; 30 messages per Member per hour.
- Back office: "Support" nav item with the waiting count; Support desk with the Waiting queue (longest wait first), views, category and assignee filters, and four stats.
- Staff ticket view: customer context, linked run, Take it, Assign, Status, Reply, Reply & wait on customer, Internal note, Close, Open as this Business (Acting as recorded with the Ticket number).
- Version checks on take, assign and status so two Staff never overwrite each other.
- Emails: new Ticket and customer reply → Staff (all Staff until assigned, then the assignee); Staff reply and close by Staff → the Member who opened it.
- Audit log for every Staff action; analytics events §3a.

### Later
- Attachments; reply by email; satisfaction rating; canned replies; help centre.
- Priority, SLA timers, auto-close after N days waiting on the customer.
- "You were assigned" emails; an email digest for Staff.
- Credit adjustments from the ticket view (through billing).
- MCP tools for the Viper desk (like the Llyner desk).
- Public "Contact us" form.

## 6. Functional requirements
Common rules:
- **Ticket number:** a global integer, starting at 1001, shown as `#1042` on both sides and used in URLs and email subjects.
- **Categories:** `billing` "Billing and credits", `run` "Research run / leads", `account` "Account and sign-in", `bug` "Bug", `other` "Other".
- **Statuses** and customer labels: `open` "Open", `in_progress` "We're on it", `waiting_on_customer` "Waiting on you", `closed` "Closed". Staff see the raw names in upper case (`IN PROGRESS`).
- **Visibility:** a Member sees a Ticket if it belongs to their Business and (they are the Owner or they opened it). Anything not visible answers 404, never 403, so numbers can't be probed.
- **Message text** is plain text (1–10,000 characters after trimming; line breaks kept). It is rendered as text, never as HTML or Markdown, in the app and in emails. Staff replies appear to customers as "Llyner Leads Support", never with the Staff Member's name.
- **Reopen window:** a closed Ticket can be reopened by a reply from either side until 30 days after `closedAt`; after that, replies answer 409 `TICKET_CLOSED_TOO_LONG` and the customer UI offers "Open a new ticket".
- **Waiting (for Staff):** a Ticket is *waiting* when its status is `open` or `in_progress` and either it has no assignee or it has a customer reply no Staff has read. `waitingSince` is set when the Ticket is opened and when a customer reply arrives (if not already set); it is cleared when a Staff Member replies, when its assignee opens it in the ticket view, and when the Ticket closes. Unassigned Tickets stay waiting until someone takes or is assigned them. Wait time = now − `coalesce(waitingSince, createdAt)`.
- **Business minutes:** minutes inside Mon–Fri 09:00–17:00 America/Chicago between two instants (US public holidays not excluded in this version), computed by a pure function `businessMinutesBetween(from, to)`.

### FR-1: Help nav and Your tickets
**Story:** As a Member, I want one place to see my support requests so that I know what's happening with each.
**Rules:**
- The customer rail gains **Help** (life-buoy icon, label and tooltip "Help") above the back-office shield; the mobile tab bar gets a 5th tab "Help". Route `/app/support`; breadcrumb `Business / Help`.
- The list shows visible Tickets: number, subject, a one-line preview (the last reply's first 80 characters with its author, "Llyner Leads Support" or the Member's name; plus "Linked run: <plan name>" when a run is linked), category, From (Owner view only), status label, updated time (time today, else `21 Nov`). Sort: open ones (not `closed`) by `lastMessageAt` desc, then closed by `closedAt` desc. Filter chips: Open (count), Closed (count), All. Default Open; 25 per page with "Show more".
- "New ticket" primary button. Side panel (desktop) / footer (mobile): reply-time promise "We usually reply within 4 business hours (Mon–Fri, US Central)", the 0-leads-not-charged note and "Up to 5 open tickets at a time".
**Errors / edge cases:** no Tickets → empty state "No tickets yet. If something's not working, we're here to help." + New ticket; load error → error state with Retry. While Acting as, "New ticket" is disabled with "Staff can't open tickets while Acting as".
**Acceptance criteria:**
- Given the Owner of a Business with tickets from two Members, when they open Help, then they see all of them with a From column.
- Given a non-Owner Member, when they open Help, then they see only the Tickets they opened, and no From column.
- Given a Ticket of another Business, when a Member requests `/api/support/tickets/<its number>`, then the answer is 404.
- Given the mobile layout, when the app renders, then the tab bar has 5 tabs and Help is `aria-current` on `/app/support`.

### FR-2: Open a ticket
**Story:** As a Member, I want to describe a problem once, with the context attached, so that Staff can help without asking basic questions.
**Rules:**
- Route `/app/support/new`, optional query `runId`, `source` (`help` default, `run`, `leads`) and `from` (the path the Member came from).
- Fields: category (required choice chips), "Which run? (optional)" select listing the Business's runs started in the last 90 days, newest first (plan name · search radius · start date and time · status), subject (5–120 characters), message (10–10,000 characters, counter shown). `⌘↵` submits.
- The server attaches: Business, opening Member, `pagePath` (the `from` path if it starts with `/app/` and is ≤ 200 characters, else null), the Business's credit balance at that moment, and `source`.
- Limits: at most **5 Tickets not closed** per Business → 422 `OPEN_TICKET_LIMIT`; at most **10 new Tickets per Member per hour** → 429 `TOO_MANY_REQUESTS` with `Retry-After`.
- On success: status `open`, `waitingSince = createdAt`, a `TicketOpened` outbox event (FR-11), `ticket_opened`, redirect to the thread with the toast "Ticket #1042 sent. We'll reply by email too."
**Errors / edge cases:** `runId` not of this Business or older than 90 days → 404 `UNKNOWN_RUN`; Acting as → 403 `NOT_WHILE_ACTING_AS`; field errors shown inline; on 422 `OPEN_TICKET_LIMIT` the form keeps the text and shows "You have 5 open tickets. Reply on one of them or close one first." with a link to Your tickets. Double submit is prevented in the UI; a server-side duplicate (same Member, same subject and message within 60 s) returns the existing Ticket with 200 instead of creating a second.
**Acceptance criteria:**
- Given a Member with 0 open Tickets, when they submit category "Research run / leads", a subject, a message and a run, then Ticket #N is `open`, linked to the run, with the balance and page stored, and Staff get the new-ticket email.
- Given a Business with 5 Tickets not closed, when any Member submits, then 422 `OPEN_TICKET_LIMIT` and nothing is created.
- Given a Member who opened 10 Tickets in the last hour, when they submit an 11th, then 429.
- Given a subject of 4 characters or a message of 9, when submitted, then 400 with field errors and the UI shows them under the fields.

### FR-3: Report a problem
**Story:** As a Member looking at a failed run or at leads that look wrong, I want to report it in one click so that the run is attached for me.
**Rules:**
- The failed run outcome ("This run didn't finish") gains a text-style link "Report a problem" after "Try again" and "Back to plan" (mobile: full-width "Something wrong? Report a problem"), plus the note "Report a problem opens a ticket with this run attached."
- The Lead list page header gains a "Report a problem" text button, linked to the most recent run of that Plan.
- Both open `/app/support/new?runId=<id>&source=run|leads&from=<current path>` with category preset to "Research run / leads" and the run selected; subject empty.
**Acceptance criteria:**
- Given a failed run, when the Member clicks Report a problem, then New ticket opens with that run selected and the category preset, and the created Ticket has `source = run`.
- Given a Lead list, when the Member clicks Report a problem, then the Plan's latest run is selected and `source = leads`.

### FR-4: Ticket thread for the Member
**Story:** As a Member, I want to read replies and answer them in one place so that the conversation stays together.
**Rules:**
- Route `/app/support/:number`. Header: subject, status pill (customer label), number, category, who opened it and when. Details panel (desktop) / card (mobile): status, category, opened, from, linked run card (plan name, start, stopped step if failed, status, credits charged, "Open run").
- Thread oldest first: customer replies (right, raised bubble, name and time), Staff replies (left, "Llyner Leads Support", time), and status events in mono ("STATUS → WE'RE ON IT · 10:31"). Internal notes and assignment events never appear.
- Reply box (`⌘↵` sends) and "Close ticket" text button.
- Customer reply effects: `waiting_on_customer` → `in_progress` if assigned, else `open`; `open`/`in_progress` unchanged; `closed` within the reopen window → `open` (assignee kept) and `ticket_reopened`. `waitingSince` set if null. Outbox `CustomerReplied` (FR-11).
- Rate limit: 30 messages per Member per hour across Tickets → 429.
**Errors / edge cases:** closed > 30 days → the reply box is replaced by "This ticket was closed on 14 Oct. Open a new ticket" (link prefilled with the same category and run); the API answers 409 `TICKET_CLOSED_TOO_LONG`. A send failure keeps the text in the box with "Couldn't send. Try again." Acting as → read-only with the reply box disabled.
**Acceptance criteria:**
- Given a Ticket `waiting_on_customer` assigned to a Staff Member, when the customer replies, then it becomes `in_progress`, appears in the Waiting queue, and the assignee gets the reply email.
- Given a Ticket closed 10 days ago, when the customer replies, then it becomes `open`, keeps its assignee, and `ticket_reopened` fires.
- Given a Ticket closed 31 days ago, when the customer replies, then 409 `TICKET_CLOSED_TOO_LONG` and the UI offers a new ticket.
- Given a Ticket with an Internal note, when the customer opens it, then the note text is not in the API response or the page.

### FR-5: Member closes a ticket
**Story:** As a Member, I want to close a Ticket when my problem is solved so that it stops being open.
**Rules:** "Close ticket" asks for confirmation ("Close #1042? You can reopen it by replying within 30 days.") and sets `closed`, `closedBy = customer`, `closedAt`, clears `waitingSince`, adds a status event. No email is sent to anyone.
**Errors / edge cases:** already closed → 409 `ALREADY_CLOSED` (UI refreshes).
**Acceptance criteria:**
- Given an open Ticket, when its opener closes it, then it shows "Closed", leaves the Open filter and the Waiting queue, and no email is sent.

### FR-6: Support desk and the Waiting queue
**Story:** As Staff, I want to see which Tickets need me, longest wait first, so that nobody waits too long.
**Rules:**
- The back-office nav gains **Support** second (after Dashboard) with a lime count badge of waiting Tickets (hidden at 0), refreshed every 60 s and on window focus. Mobile: the menu button shows the same badge.
- Route `/app/staff/support`. Stats strip: Waiting (count), Longest wait (`2 h 10 m`), First reply, median (30 d) in business time, Closed ≤ 3 days (30 d) in %. Stats over Tickets opened in the last 30 days; "—" when there are none.
- Views (chips with counts): **Waiting** (default; the waiting rule, sorted by wait time desc), **Mine** (assigned to me, not closed, by `lastMessageAt` desc), **Waiting on customer** (`waiting_on_customer`, by `lastMessageAt` asc), **Closed** (by `closedAt` desc), **All** (by `createdAt` desc). Filters: category, assignee (Anyone, Me, Nobody, each Staff Member).
- Table: number, subject (+ "● new customer reply" when unread), Business · From, category, status, assignee ("nobody" muted), Waiting (wait time; "—" outside Waiting). Mobile: stacked cards. 25 per page with cursor.
**Errors / edge cases:** empty Waiting → "Nothing waiting. Nice." with a link to All; non-Staff → 403 and the item is hidden.
**Acceptance criteria:**
- Given an unassigned open Ticket opened 2 h ago and an assigned one with a customer reply 52 min ago, when Staff open Support, then both are listed, the older first, and the badge shows 2.
- Given an assigned `in_progress` Ticket whose customer reply was read by the assignee, then it is not in Waiting but is in Mine.
- Given three first replies after 30, 90 and 600 business minutes in the last 30 days, then the median stat shows `1 h 30 m`.

### FR-7: Staff ticket view
**Story:** As Staff, I want the whole Ticket and the customer's context on one screen so that I can answer without hunting.
**Rules:**
- Route `/app/staff/support/:number`. Header bar: "Take it" (or "Taken by you" / "Assigned to <name>"), Assignee select, Status select. Title, category, opened time, "first reply after `50 m`".
- Thread: everything in FR-4 plus Internal notes (amber dashed border, "INTERNAL NOTE · only Staff see this", author and time) and events "TAKEN BY <name>", "ASSIGNED TO <name>/NOBODY", status changes with who did it. Staff replies show "You, as Llyner Leads Support" or "<name>, as Llyner Leads Support" and "emailed".
- Side panel: Business, From (name · role), current credit balance (and the balance at open if different), page, open Tickets of this Business, **Open as this Business** button (starts Acting as through the existing `POST /api/staff/acting-as` with `ticketNumber`, so the Audit log entry names the Ticket), and the linked run card (plan, attempt, stopped step, last error, status, credits charged, "Open in Runs" → `/app/staff/runs/:id`).
- When the **assignee** opens the view, the Ticket's customer replies count as read (`waitingSince` cleared). Other Staff opening it, or anyone opening an unassigned Ticket, changes nothing: unassigned Tickets stay waiting until someone takes them or is assigned.
**Acceptance criteria:**
- Given a Ticket linked to a failed run, when Staff open it, then the run's stopped step, last error and credits charged are shown, and "Open in Runs" goes to the Staff run page.
- Given Staff click Open as this Business, then Acting as starts for that Business and the Audit log entry `acting_as.started` includes `ticketNumber`.
- Given the assignee opens a Ticket with an unread customer reply, then it leaves the Waiting queue.

### FR-8: Take and assign
**Story:** As Staff, I want to claim a Ticket or hand it to someone so that each Ticket has one owner.
**Rules:**
- **Take it:** assignee = me; status `open` or `waiting_on_customer` → `in_progress` (`in_progress` stays). Not allowed on `closed` (409 `TICKET_CLOSED`).
- **Assign:** assignee = any Staff Member or nobody. Assigning doesn't change status. Assigning to nobody puts the Ticket back in the Waiting queue.
- Take, assign and status changes carry the Ticket `version` read; a stale version answers 409 `VERSION_CONFLICT` with the current Ticket, and the UI shows "Someone changed this ticket. Here's the latest." with the refreshed view. Every successful change increments `version`.
**Acceptance criteria:**
- Given two Staff with the same Ticket at version 3, when both click Take it, then one succeeds (version 4) and the other gets 409 with the Ticket now assigned to the first.
- Given an `open` unassigned Ticket, when Staff take it, then it is `in_progress`, assigned to them, the customer sees "We're on it" and a status event, and no email is sent.

### FR-9: Staff reply, reply and wait, status, close
**Story:** As Staff, I want to answer the customer, ask them something, or close the Ticket so that problems get resolved.
**Rules:**
- **Reply** (plain text, 1–10,000): adds a Staff reply; if status is `open` → `in_progress` and, if unassigned, assigns the replier; clears `waitingSince`; sets `firstStaffReplyAt` if null; outbox `StaffReplied` (FR-11).
- **Reply & wait on customer:** as Reply, then status `waiting_on_customer`.
- **Status select:** any of the four. Setting `closed` = Close.
- **Close:** status `closed`, `closedBy = staff`, `closedAt`; clears `waitingSince`; outbox `TicketClosed` → email to the opener. An optional reply typed in the box is sent first ("Close ticket" with text = reply then close; one email containing both).
- **Reopen:** a Staff reply on a closed Ticket within the reopen window reopens it to `in_progress`; after the window, 409 `TICKET_CLOSED_TOO_LONG`. Setting a status other than `closed` on a closed Ticket within the window also reopens it.
- Replies don't need a version (they never overwrite); status changes do (FR-8).
**Acceptance criteria:**
- Given an `in_progress` Ticket, when Staff use Reply & wait, then the customer sees the reply, the status "Waiting on you", gets one email, and the Ticket appears under Waiting on customer.
- Given the first Staff reply 50 business minutes after opening, then `ticket_replied` has `is_first_staff_reply = true` and `business_minutes_to_first_reply = 50`.
- Given Staff close a Ticket with text in the reply box, then the reply is added, the Ticket closes, and the opener gets one email with the reply and "We've closed this ticket".

### FR-10: Internal notes
**Story:** As Staff, I want notes only Staff can read so that I can record findings without the customer seeing them.
**Rules:** the composer has two tabs, "Reply to customer" and "Internal note". A note (1–10,000) is added to the thread for Staff only; it changes no status, sends no email, doesn't count as a first reply, and doesn't clear `waitingSince`. Notes are never returned by customer endpoints.
**Acceptance criteria:**
- Given Staff add a note, then the customer API and page for that Ticket do not contain it, no email is queued, and the Audit log has `support.note_added`.

### FR-11: Emails
**Story:** As a Member or Staff, I want an email when the other side acts so that I don't have to keep checking.
**Rules:** all sent through the outbox and the worker (`support` queue), from the SMTP from-address in Platform settings with the display name "Llyner Leads Support", subject prefixed `[#<number>]`, with an "Open the ticket" / "Open in the Support desk" button linking to the app (login required) and the message text escaped. Retries: 5 with backoff; a failed email never fails the user's action.
| Event | Recipients | Subject | Body |
|---|---|---|---|
| `TicketOpened` | all Staff (`staffRecipients`) | `[#1042] New ticket · <category> · <Business>` | Business, From (name · role), category, linked run, the message |
| `CustomerReplied` | the assignee; all Staff if unassigned | `[#1042] New reply · <Business>` | the reply, status |
| `StaffReplied` | the Member who opened it | `[#1042] New reply: <subject>` | "We replied to your ticket", the reply, "Reply in Llyner Leads to keep everything in one place. Replies to this email aren't read." |
| `TicketClosed` (by Staff) | the opener | `[#1042] Closed: <subject>` | the closing reply if any, "We've closed this ticket. Reply within 30 days to reopen it." |
No emails for Internal notes, take, assign, status changes other than close, or customer closes. Copy says "Llyner Leads" (never Viper). If the opener no longer exists, the email is skipped and logged.
**Acceptance criteria:**
- Given a new Ticket, when the outbox is processed, then each Staff Member gets one "New ticket" email in Mailpit.
- Given an assigned Ticket, when the customer replies, then only the assignee gets the email.
- Given Staff reply, then only the opener gets the email, with the reply text escaped (a `<b>` in the text shows literally).

### FR-12: Audit, analytics and permissions
**Rules:**
- Audit log (platform `AuditLog`) for every Staff action, with `ticketNumber`: `support.ticket_viewed` (first view per Staff per Ticket per day), `support.taken`, `support.assigned` {from, to}, `support.status_changed` {from, to}, `support.replied` {waitOnCustomer}, `support.note_added`, `support.closed`, `support.reopened`. `acting_as.started` gains `ticketNumber` when started from a Ticket.
- Analytics events §3a.
- Permissions §4: customer endpoints use `session` and the visibility rule; Staff endpoints use `staff` and ignore Acting as.
**Acceptance criteria:**
- Given a Member, when they call any `/api/staff/support/*` endpoint, then 403.
- Given Staff Acting as a Business, when they `POST /api/support/tickets`, then 403 `NOT_WHILE_ACTING_AS`; `GET /api/support/tickets` returns the Owner's view.
- Given each Staff action in FR-7–FR-10, then exactly one Audit log entry is written with the Ticket number.

## 6a. Acceptance journeys
### AJ-1: Report a problem on a failed run
**Persona:** Sam (Owner) · **Covers:** FR-2, FR-3, FR-11, FR-6
1. Log in as `owner@demo.test`, open the seeded failed run "Bakeries near Austin".
2. Click "Report a problem"; New ticket shows the run selected and "Research run / leads" chosen.
3. Type a subject and message, send.
4. See the thread with status "Open" and the toast with the ticket number.
5. In Mailpit, `staff@demo.test` has "[#N] New ticket · Research run / leads · Sweet Supply Co".
6. Log in as Staff; the back-office nav shows "Support" with a badge; the Ticket is first in Waiting.
**Expected:** the Ticket exists, linked to the run, visible to the customer and at the top of the Waiting queue.

### AJ-2: Take, ask, answer
**Persona:** Staff and Sam · **Covers:** FR-7, FR-8, FR-9, FR-4, FR-11
1. As Staff, open the waiting Ticket, click "Take it": status IN PROGRESS, assigned to you.
2. Write a question, click "Reply & wait on customer".
3. As Sam, Mailpit has "[#N] New reply: …"; Help shows "Waiting on you"; open the Ticket and reply.
4. As Staff, the Ticket is back in Waiting with "● new customer reply"; Mailpit has the reply email for Staff; open it (it leaves Waiting).
**Expected:** statuses move open → in progress → waiting on customer → in progress; each side got exactly one email per counterpart message.

### AJ-3: Internal note and Open as this Business
**Persona:** Staff · **Covers:** FR-7, FR-10, FR-12
1. As Staff, open a Ticket, switch to "Internal note", add a note.
2. Click "Open as this Business"; the app opens as Sweet Supply Co with the Acting as banner; open Help and the Ticket.
3. Stop Acting as; open the Audit log.
**Expected:** the note isn't visible in the customer view (also not while Acting as); the reply box is disabled while Acting as; the Audit log shows `support.note_added` and `acting_as.started` with the Ticket number.

### AJ-4: Close and reopen
**Persona:** Sam and Staff · **Covers:** FR-5, FR-9, FR-4, FR-11
1. As Staff, type a final reply and close the Ticket; Sam gets one "[#N] Closed: …" email.
2. As Sam, the Ticket shows "Closed"; reply "Actually, one more thing"; it becomes "Open" again and returns to Waiting.
3. Open the seeded Ticket closed 40 days ago: the reply box is replaced by "Open a new ticket".
**Expected:** reopen works inside 30 days and is refused after.

### AJ-5: Who sees what
**Persona:** Owner and Member · **Covers:** FR-1, FR-12
1. Log in as `member@demo.test` (Jo Kim, Member of Sweet Supply Co): Help lists only Jo's Ticket.
2. Visit `/app/support/<Sam's ticket number>`: "Ticket not found".
3. Log in as `owner@demo.test`: Help lists both, with a From column.
**Expected:** Members see only their own Tickets; Owners see the Business's.

### AJ-6: Limits and bad input (failure path)
**Persona:** Sam, a Member · **Covers:** FR-2, FR-12
1. Submit New ticket with a 3-character subject: inline error, nothing sent.
2. With the Business at 5 open Tickets (seeded state toggle via the test helper), submit a valid Ticket: "You have 5 open tickets…" and the text is kept.
3. As a Member, open `/app/staff/support`: the back office is not available.
**Expected:** nothing created; clear messages; no Staff access.

## 6b. Screens
Mocks (Design artifact): [Llyner Leads Support Tickets](https://claude.ai/artifact/SrDWfKzHpYg9eKUydh7HKf), approved 2026-11-21. Workflow row: FlowBefore / Main (after). Screen rows (mobile and desktop, before and after): Tickets (`/app/support` + nav), New (`/app/support/new`), Thread (`/app/support/:number`), Run (`/app/runs/:id` failed), Desk (`/app/staff/support`), Staff (`/app/staff/support/:number`); emails EmailReply, EmailNewTicket.

| Screen | Route | Purpose | Empty / loading / error states |
|--------|-------|---------|--------------------------------|
| Your tickets | `/app/support` | List the Member's / Business's Tickets | Empty: "No tickets yet…" + New ticket; skeleton rows; error + Retry |
| New ticket | `/app/support/new` | Open a Ticket | Run select empty → "No runs in the last 90 days"; field errors; limit banner; send error keeps text |
| Ticket thread | `/app/support/:number` | Read and reply, close | Not found: "Ticket not found" + back link; closed > 30 d: new-ticket prompt; send error keeps text |
| Failed run (changed) | `/app/runs/:id` | Adds Report a problem | unchanged |
| Lead list (changed) | `/app/plans/:id/leads` | Adds Report a problem | unchanged |
| Support desk | `/app/staff/support` | Waiting queue and views | Empty Waiting: "Nothing waiting. Nice."; skeleton; error + Retry; stats "—" |
| Staff ticket view | `/app/staff/support/:number` | Work the Ticket | Not found; version conflict banner; send error keeps text |

## 7. Interfaces
Conventions as in prd-first-version §7 (JSON, UUID v7 ids, ISO 8601 UTC, errors `{ error: { code, message, fields? } }`, cursor lists, `session` / `staff` auth, Origin check, 401/403). `TicketNumber` = int ≥ 1001 in paths. `Category` = `billing|run|account|bug|other`. `Status` = `open|in_progress|waiting_on_customer|closed`. `Source` = `help|run|leads`. `Text` = string, trimmed, 1–10,000.

Shared shapes:
- `RunRef = { id, planId, planName, startedAt, status: "running"|"retrying"|"completed"|"failed"|"cancelled", stoppedStep: { number: int, name } | null, creditsCharged: int }`
- `TicketSummary = { number, subject, category, status, source, openedBy: { id, name }, preview: { author: "customer"|"support", authorName, text (≤ 80) } | null, run: { id, planName } | null, lastMessageAt, closedAt: string|null, createdAt }`
- `CustomerMessage = { id, kind: "customer_reply"|"staff_reply"|"status_event", body: string|null, author: { kind: "member", id, name } | { kind: "support", name: "Llyner Leads Support" } | null, status: Status|null (status_event only), createdAt }`
- `TicketDetail = TicketSummary & { run: RunRef|null, messages: CustomerMessage[], canReply: bool, canClose: bool, reopenUntil: string|null, readOnly: bool (Acting as) }`
- `StaffMessage = { id, kind: "customer_reply"|"staff_reply"|"internal_note"|"event", body: string|null, author: { id, name, isStaff: bool } | null, event: { type: "status_changed", from, to } | { type: "taken" } | { type: "assigned", to: { id, name } | null } | { type: "reopened" } | null, emailed: bool, createdAt }`
- `StaffTicketSummary = TicketSummary & { business: { id, name }, assignee: { id, name } | null, waitingSince: string|null, waitMinutes: int|null, unreadCustomerReply: bool, version: int }`
- `StaffTicketDetail = StaffTicketSummary & { messages: StaffMessage[], run: (RunRef & { attempt: int, lastError: string|null }) | null, context: { pagePath: string|null, balanceAtOpen: int|null, balanceNow: int, openedByRole: "owner"|"member", businessOpenTickets: int }, firstStaffReplyAt: string|null, businessMinutesToFirstReply: int|null, reopenUntil: string|null }`

### Customer (auth `session`)
- `GET /api/support/tickets?status=open|closed|all&cursor&limit`: 200 `{ items: TicketSummary[], counts: { open: int, closed: int }, showFrom: bool, nextCursor }`. Default `open`.
- `POST /api/support/tickets`: Req `{ category: Category, subject: string 5..120, message: string 10..10,000, runId?: uuid, source?: Source (default help), pagePath?: string ≤ 200 }`. 201 `TicketDetail` (200 for the 60-s duplicate). Errors 400 `VALIDATION_ERROR`, 403 `NOT_WHILE_ACTING_AS`, 404 `UNKNOWN_RUN`, 422 `OPEN_TICKET_LIMIT { limit: 5 }`, 429 `TOO_MANY_REQUESTS`.
- `GET /api/support/tickets/:number`: 200 `TicketDetail`. Errors 404 `TICKET_NOT_FOUND`.
- `POST /api/support/tickets/:number/replies`: Req `{ message: Text }`. 201 `TicketDetail`. Errors 400, 403 `NOT_WHILE_ACTING_AS`, 404, 409 `TICKET_CLOSED_TOO_LONG { closedAt }`, 429.
- `POST /api/support/tickets/:number/close`: Req `{}`. 200 `TicketDetail`. Errors 403 `NOT_WHILE_ACTING_AS`, 404, 409 `ALREADY_CLOSED`.
- `GET /api/support/runs`: the run picker. 200 `{ items: RunRef[] }` (Business's runs started in the last 90 days, newest first, max 50).

### Staff (auth `staff`)
- `GET /api/staff/support/tickets?view=waiting|mine|waiting_on_customer|closed|all&category&assignee=me|nobody|<memberId>&cursor&limit`: 200 `{ items: StaffTicketSummary[], counts: { waiting, mine, waitingOnCustomer }, stats: { waiting: int, longestWaitMinutes: int|null, firstReplyMedianBusinessMinutes30d: int|null, closedWithin3DaysPct30d: int|null }, nextCursor }`.
- `GET /api/staff/support/count`: 200 `{ waiting: int }` (nav badge).
- `GET /api/staff/support/staff`: 200 `{ items: [{ id, name, email }] }` (assignee picker).
- `GET /api/staff/support/tickets/:number`: 200 `StaffTicketDetail` (marks read per FR-7). Errors 404.
- `POST /api/staff/support/tickets/:number/take`: Req `{ version: int }`. 200 `StaffTicketDetail`. Errors 404, 409 `VERSION_CONFLICT { ticket: StaffTicketDetail }`, 409 `TICKET_CLOSED`.
- `POST /api/staff/support/tickets/:number/assign`: Req `{ version: int, assigneeId: uuid|null }`. 200. Errors 404, 404 `UNKNOWN_STAFF`, 409 `VERSION_CONFLICT`.
- `POST /api/staff/support/tickets/:number/status`: Req `{ version: int, status: Status }`. 200. Errors 404, 409 `VERSION_CONFLICT`, 409 `TICKET_CLOSED_TOO_LONG`.
- `POST /api/staff/support/tickets/:number/replies`: Req `{ message: Text, then?: "wait_on_customer"|"close" }`. 201 `StaffTicketDetail`. Errors 400, 404, 409 `TICKET_CLOSED_TOO_LONG`.
- `POST /api/staff/support/tickets/:number/notes`: Req `{ note: Text }`. 201 `StaffTicketDetail`. Errors 400, 404.
- `POST /api/test/support/close-ago`: only when `NODE_ENV=test`; Req `{ number, days }` back-dates `closedAt`. And `POST /api/test/support/fill-open`: Req `{ businessId, count }` creates open Tickets to reach the limit.

### Identity (changed)
- `POST /api/staff/acting-as`: Req gains optional `ticketNumber: int`; it is stored in the `acting_as.started` Audit log entry. No other change.

### Module ports (public functions, not HTTP)
- identity → support: `memberSummaries(ids) → [{ id, name, email, businessId, role: "owner"|"member", isStaff }]`; `staffRecipients() → [{ memberId, email, name }]` (exists); `staffMembers() → [{ id, name, email }]`; `businessNames(ids) → [{ id, name }]`.
- research → support: `recentRunsForBusiness(businessId, since: Date, limit) → RunRef[]`; `runForSupport(runId) → (RunRef & { businessId, attempt, lastError: string|null }) | null`.
- billing → support: `balanceFor(businessId) → int` (use the existing header-balance read if it matches; otherwise add it).
- platform → support: existing `AuditLog`, `AnalyticsTracker`, `EmailSender` (via outbox).

### External integrations
| Service | Purpose | Auth | When it's down |
|---------|---------|------|----------------|
| SMTP provider | the four ticket emails | existing Platform settings | outbox retries 5× with backoff; the action already succeeded; failure logged and visible in the worker logs |

## 8. Data model
| Entity | Fields (type, constraints) | Relationships | Context |
|--------|----------------------------|---------------|---------|
| support_tickets | id uuid PK; number int AUTO_INCREMENT UNIQUE (starts 1001); business_id FK businesses ON DELETE CASCADE; opened_by_member_id FK members; category enum(billing, run, account, bug, other); subject varchar(120); status enum(open, in_progress, waiting_on_customer, closed); assignee_member_id FK members null; run_id uuid null (no FK across contexts); source enum(help, run, leads); page_path varchar(200) null; balance_at_open int null; version int default 0; waiting_since datetime(3) null; first_staff_reply_at datetime(3) null; last_message_at datetime(3); last_message_by enum(customer, staff); closed_at datetime(3) null; closed_by enum(customer, staff) null; created_at, updated_at datetime(3). Indexes: (business_id, status, last_message_at), (opened_by_member_id, created_at), (status, waiting_since), (assignee_member_id, status), (created_at) | 1–n support_messages | support |
| support_messages | id uuid PK; ticket_id FK support_tickets ON DELETE CASCADE; kind enum(customer_reply, staff_reply, internal_note, event); author_member_id FK members null; body text null (≤ 10,000 chars, validated in app); event json null (`{ type, from?, to?, assigneeId? }`); emailed bool default false; created_at datetime(3). Index (ticket_id, created_at), (author_member_id, created_at) for the message rate limit | n–1 support_tickets | support |
| support_ticket_views | ticket_id FK, member_id FK, last_viewed_at datetime(3); PK (ticket_id, member_id) (for the once-per-day audit and read state) | | support |

Volume: < 50 Tickets/month in the first year, < 20 messages each. Retention: kept while the Business exists; deleted with it (cascade). Messages are immutable (no edit or delete). Migration: none; no existing data.

### 8a. Demo seed data
Added to the existing seed (Business "Sweet Supply Co", `owner@demo.test` is Sam Rivera; Staff `staff@demo.test`):
- New Member `member@demo.test` / `demo1234`: Jo Kim, Member (not Owner) of Sweet Supply Co.
- A failed run on Plan "Bakeries near Austin" (stopped at step 03 Website reader, 0 credits charged), if the research seed doesn't already have one.
- Tickets (numbers from 1001):
  - #1001 "Run stopped at Website reader", run, by Sam, linked to the failed run, `in_progress`, assigned to Staff; Sam's message, status event, an Internal note, a Staff reply.
  - #1002 "Invoice for my Starter pack", billing, by Jo, `waiting_on_customer`, Staff reply asking which company name to use.
  - #1003 "Two phone numbers look wrong", run, by Sam, `closed` by Staff 6 days ago (reopenable).
  - #1004 "Can't find the CSV export", other, by Sam, `closed` 40 days ago (not reopenable).
  - #1005 "Can't add my assistant as a Member", account, by the Owner of Clean Desk Co (`new@demo.test`), `open`, unassigned (waiting).
All names and text are invented.

## 9. Technical notes
- `members.role` becomes `ENUM('owner','member')` (migration in W0). Only the seed creates Members until team invites ship; no other identity behaviour changes.
- New bounded context **support** (ADR 0021): `apps/api/src/modules/support` (domain, application/customer, application/staff, application/notifications, http, infrastructure), web `apps/web/src/features/support` with `customer/` and `staff/` subfolders; the staff pages mount inside the back-office layout.
- Domain core: a `Ticket` aggregate with pure transition functions (`open`, `customerReply`, `staffReply`, `note`, `take`, `assign`, `setStatus`, `close`, `markRead`) returning the new state plus the events and messages to persist; the visibility rule and the waiting rule as pure functions; `businessMinutesBetween` (America/Chicago via `Intl`, no new dependency).
- Persistence: one transaction per command writes the ticket row (`UPDATE … WHERE id = ? AND version = ?` for versioned commands), the messages, and the outbox events. Ticket numbers come from AUTO_INCREMENT (set to 1001 in the migration).
- Worker: a `support` BullMQ queue consuming `TicketOpened`, `CustomerReplied`, `StaffReplied`, `TicketClosed`; registered in `worker-registry.ts` by the orchestrator. Email templates follow the existing transactional email layout.
- Rate limits counted in the database like identity's (`rate-limits.ts` pattern): tickets per Member per hour from `support_tickets`, messages per Member per hour from `support_messages`.
- Web: copy in `features/support/copy.ts` (UI text in one place); nav items added by the orchestrator to `customerNav` (`section: 'help'`, icon `help`/life-buoy, added to `shared/ui` icons in W0) and `staffNav`; the badge uses a `useSupportWaitingCount` hook exported by the feature (`refetchInterval: 60_000`).
- Ticket text is customer-written: treat it as data everywhere (never interpolate into prompts; if Claude is ever used on tickets, fence it).
- No new npm dependencies.

## 10. Non-functional requirements
- NFR-1: Performance: `GET /api/staff/support/tickets` and `GET /api/support/tickets` p95 < 200 ms with 5,000 Tickets and 100,000 messages; `GET /api/staff/support/count` p95 < 50 ms.
- NFR-2: Security / privacy: visibility enforced server-side on every customer endpoint (404 for invisible); Internal notes never serialised by customer endpoints (contract schemas exclude them; a test asserts it); text rendered as plain text and escaped in emails; Staff names never shown to customers; rate limits as in FR-2/FR-4; Origin check on every POST.
- NFR-3: Accessibility: WCAG 2.1 AA; statuses always as words; the composer tabs are a real tablist; thread is an ordered list with author and time in text; `⌘↵` has a visible button equivalent; focus moves to the new message after sending.
- NFR-4: Reliability: an SMTP outage never fails a ticket action; emails are sent at most once per event (outbox idempotency key = event id).

## 11. Testing notes
- Domain: table-driven tests for every transition (status × action × actor × reopen window), the visibility rule, the waiting rule and `businessMinutesBetween` (weekends, DST changes in March and November, before 09:00 and after 17:00, spans over several days).
- Integration (MySQL): version conflict under two concurrent takes; the 5-open limit under two concurrent creates (count inside the transaction with `FOR UPDATE` on the Business's open tickets or a unique-guard approach); AUTO_INCREMENT starts at 1001; rate-limit windows.
- HTTP: every endpoint for 401/403/404 and the visibility rule; a snapshot test that no customer response contains `internal_note` kinds.
- Emails: rendered in Mailpit in integration tests; escaping test.
- Fixed clock `2026-11-21T15:00:00Z` (a Saturday, use `2026-11-20T15:00:00Z` Friday for business-hour cases). Playwright uses the seed plus the two test helpers.

## 12. Release notes
- Migration: `support_tickets` (AUTO_INCREMENT = 1001), `support_messages`, `support_ticket_views`. Pre-deploy migration job (existing).
- No new env vars, settings or secrets. Check that the SMTP from-address in Platform settings is a support address the founder reads (open question below).
- The worker picks up the `support` queue on deploy.
- After deploy: add the support email to the site footer (already planned as the fallback contact).

## 13. Assumptions & decisions
- Copy the Llyner desk's model (statuses, take, assign, internal notes, waiting queue, versions, 30-day reopen) so the founder works both desks the same way.
- Status `waiting_on_customer` (not "waiting_on_owner") because any Member can open a Ticket.
- Owner sees all Business Tickets; Members only their own; invisible Tickets answer 404.
- Staff can't open Tickets while Acting as; Acting as shows the customer view read-only.
- Staff replies are signed "Llyner Leads Support" to customers; the Staff name shows only inside the desk.
- A Staff reply on an `open` Ticket moves it to `in_progress` and assigns the replier if unassigned (saves a click).
- A customer reply on `waiting_on_customer` returns it to `in_progress` if assigned, else `open`; a reopened Ticket keeps its assignee.
- Emails: all Staff until assigned, then the assignee only; customers get Staff replies and Staff closes only; emails go to the opener, not the Owner.
- Limits: 5 Tickets not closed per Business; 10 new Tickets and 30 messages per Member per hour; 60-s duplicate suppression.
- Linked run limited to the Business's runs from the last 90 days; the Lead list's Report a problem links the Plan's latest run.
- Business hours Mon–Fri 09:00–17:00 America/Chicago, no holidays, for the first-reply metric.
- Ticket numbers are global (not per Business), starting at 1001.
- Help is a 5th mobile tab; on desktop it sits in the rail above the back-office shield. Support is second in the back-office nav.
- Internal notes and assignment are Staff-only events; customers see status changes only.
- New `support` context rather than extending identity or platform.

## 14. Risks & open questions
- [ ] Which address do support emails come from (`support@leads.llyner.com`?), and does the founder read that mailbox for stray replies? Founder, not blocking (uses the existing SMTP from-address until set).
- [ ] Should US public holidays count as non-business time for the first-reply metric? Founder, not blocking (Later).
- [ ] With one operator, "all Staff" means one inbox; revisit routing when a second Staff joins. Not blocking.
- [ ] Customers may reply to emails despite the note; those replies go unread unless the from-address is a real mailbox. Founder, not blocking (reply-by-email is Later).

## 15. Change log
| Version | Date | Change |
|---------|------|--------|
| 0.1 | 2026-11-21 | Initial draft from the approved Support Tickets canvas |
| 0.2 | 2026-11-21 | Build preflight: `members.role` only allowed `owner` (team members aren't built yet), so W0 widens it to `owner`/`member`; identity seeds Jo Kim as a Member and research seeds the failed run; support seeds only Tickets |

## 16. Execution plan
| Wave | Package | Title | Model | Depends on | FRs / AJs |
|------|---------|-------|-------|------------|-----------|
| W0 | WP-0 | Contracts, migrations, table types, support skeletons, ports, icon, seed hooks | opus | — | all |
| W1 | WP-1 | support domain core + repository (Ticket aggregate, rules, business minutes) | opus | WP-0 | FR-2, 4, 5, 6, 8, 9, 10 rules |
| W1 | WP-2 | cross-module ports: research runs, billing balance, identity members/staff, acting-as ticketNumber | sonnet | WP-0 | FR-2, 7, 12 |
| W1 | WP-3 | web customer feature: Help, New ticket, thread, Report a problem | sonnet | WP-0 | FR-1–5 |
| W1 | WP-4 | web staff feature: Support desk, ticket view, nav badge hook | sonnet | WP-0 | FR-6–10 |
| W1 | WP-5 | support API: customer endpoints + seed | sonnet | WP-1, WP-2 | FR-1–5, 12 |
| W1 | WP-6 | support API: staff endpoints | sonnet | WP-1, WP-2 | FR-6–10, 12 |
| W1 | WP-7 | support emails (outbox consumers, templates) | sonnet | WP-1, WP-2 | FR-11 |
| W2 | WP-8 | Playwright specs AJ-1 to AJ-6 | sonnet | WP-3–WP-7 | AJ-1–6 |
| W2 | WP-R | hardening and review | opus | WP-8 | all |

| Wave | Demo: what you can see or try | Journeys unlocked |
|------|-------------------------------|-------------------|
| W0 | Migrations run; contracts compile; `./dev seed` creates Jo Kim; the Help item and Support nav item render (empty pages) | — |
| W1 | Full flow by hand with the seed: report a problem on the failed run, see it in Waiting with the badge, take it, reply & wait, answer as Sam, internal note, Open as this Business, close and reopen; emails in Mailpit | — |
| W2 | Every journey walked by hand and passing in Playwright; review findings fixed | AJ-1–6 |

```yaml
execution:
  orchestrator_model: opus
  waves:
    - id: W0
      name: Foundation
      parallel: false
      demo: "Migrations run; contracts compile; seed creates Jo Kim; Help and Support nav items render"
      journeys: []
      packages:
        - id: WP-0
          title: Contracts, migrations, table types, support skeletons, ports, icon, seed hooks
          model: opus
          requirements: all
          owns: ["packages/contracts/src/support.ts", "packages/contracts/src/support.test.ts", "packages/contracts/src/index.ts", "apps/api/migrations/*_support_*", "apps/api/src/modules/support/index.ts", "apps/api/src/modules/support/ports.ts", "apps/api/src/modules/support/infrastructure/tables.ts", "apps/api/src/shared/infrastructure/db/schema.ts", "apps/web/src/features/support/index.ts", "apps/web/src/shared/ui/icons*", "apps/api/src/scripts/seed*.ts"]
          dependencies: []
          depends_on: []
          done_when: ["a contract exists for every §7 endpoint with request, response and error schemas, and customer schemas cannot carry internal notes", "migrations create every §8 table with AUTO_INCREMENT 1001", "module ports from §7 declared with exact signatures in support/ports.ts", "help icon in shared/ui", "./dev test green"]
    - id: W1
      name: Support tickets
      parallel: true
      demo: "Full customer and Staff flow by hand with the seed; emails in Mailpit"
      journeys: []
      packages:
        - id: WP-1
          title: support domain core and repository
          model: opus
          requirements: [FR-2, FR-4, FR-5, FR-6, FR-8, FR-9, FR-10]
          owns: ["apps/api/src/modules/support/domain/**", "apps/api/src/modules/support/infrastructure/**", "apps/api/src/modules/support/test/**"]
          depends_on: [WP-0]
          done_when: ["table-driven transition tests for every status × action × actor × reopen window", "visibility and waiting rules tested", "businessMinutesBetween tested incl. DST and weekends", "repository integration tests: versioned update conflict, open-ticket limit under concurrency, AUTO_INCREMENT from 1001, outbox rows written in the same transaction"]
        - id: WP-2
          title: cross-module ports (research, billing, identity) and acting-as ticketNumber
          model: sonnet
          requirements: [FR-2, FR-7, FR-12]
          owns: ["apps/api/src/modules/research/**", "apps/api/src/modules/billing/**", "apps/api/src/modules/identity/**"]
          depends_on: [WP-0]
          done_when: ["recentRunsForBusiness and runForSupport integration tests (business scoping, 90-day window, stopped step)", "balanceFor tested", "memberSummaries, staffMembers, businessNames tested", "acting_as.started audit includes ticketNumber when given"]
        - id: WP-3
          title: web customer feature (Help, New ticket, thread, Report a problem)
          model: sonnet
          requirements: [FR-1, FR-2, FR-3, FR-4, FR-5]
          owns: ["apps/web/src/features/support/customer/**", "apps/web/src/features/support/copy.ts", "apps/web/src/features/support/test/customer-handlers.ts", "apps/web/src/features/research/pages/run-page.tsx", "apps/web/src/features/research/pages/run-page.test.tsx", "apps/web/src/features/leads/pages/leads-page.tsx", "apps/web/src/features/leads/pages/leads-page.test.tsx"]
          depends_on: [WP-0]
          done_when: ["screens match the approved after-boards on mobile and desktop", "pages and forms tested with Testing Library and MSW handlers that parse the contracts", "empty, loading, error, limit, closed-too-long and Acting as read-only states tested", "Report a problem links tested on run and leads pages"]
        - id: WP-4
          title: web staff feature (Support desk, ticket view, badge hook)
          model: sonnet
          requirements: [FR-6, FR-7, FR-8, FR-9, FR-10]
          owns: ["apps/web/src/features/support/staff/**", "apps/web/src/features/support/test/staff-handlers.ts"]
          depends_on: [WP-0]
          done_when: ["desk and ticket view match the approved after-boards", "views, filters, stats, take/assign/status with version conflict banner, reply/reply & wait/close, internal note tab tested with MSW", "useSupportWaitingCount hook exported and tested"]
        - id: WP-5
          title: support API customer endpoints and seed
          model: sonnet
          requirements: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-12]
          owns: ["apps/api/src/modules/support/application/customer/**", "apps/api/src/modules/support/http/customer.routes.ts", "apps/api/src/modules/support/http/customer.routes.test.ts", "apps/api/src/modules/support/seed.ts"]
          depends_on: [WP-1, WP-2]
          done_when: ["HTTP tests per endpoint incl. 401, 404 visibility, 403 Acting as, 422 limit, 429 rate limits, 409 reopen window", "no customer response contains internal notes", "analytics events asserted", "seed produces §8a"]
        - id: WP-6
          title: support API staff endpoints
          model: sonnet
          requirements: [FR-6, FR-7, FR-8, FR-9, FR-10, FR-12]
          owns: ["apps/api/src/modules/support/application/staff/**", "apps/api/src/modules/support/http/staff.routes.ts", "apps/api/src/modules/support/http/staff.routes.test.ts", "apps/api/src/modules/support/http/test-hooks.routes.ts"]
          depends_on: [WP-1, WP-2]
          done_when: ["HTTP tests per endpoint incl. 403 for Members", "waiting queue order and stats tested against FR-6 examples", "version conflict returns the current ticket", "one Audit log entry per Staff action asserted", "test hooks registered only when NODE_ENV=test"]
        - id: WP-7
          title: support emails
          model: sonnet
          requirements: [FR-11]
          owns: ["apps/api/src/modules/support/application/notifications/**", "apps/api/src/modules/support/email/**"]
          depends_on: [WP-1, WP-2]
          done_when: ["recipient rules tested (all Staff vs assignee vs opener)", "templates escape text and say Llyner Leads", "emails render in Mailpit in an integration test", "idempotent per event id"]
    - id: W2
      name: Journeys and hardening
      parallel: false
      demo: "Every AJ passes in Playwright; review findings fixed"
      journeys: [AJ-1, AJ-2, AJ-3, AJ-4, AJ-5, AJ-6]
      packages:
        - id: WP-8
          title: Playwright specs AJ-1 to AJ-6
          model: sonnet
          owns: ["e2e/aj-support-*.spec.ts"]
          depends_on: [WP-3, WP-4, WP-5, WP-6, WP-7]
          done_when: ["each AJ has a passing spec"]
        - id: WP-R
          title: Hardening and review
          model: opus
          owns: []
          depends_on: [WP-8]
          done_when: ["security checklist passes (visibility, notes never leak, escaping, rate limits, Origin)", "NFR-1 measured", "every FR and AJ maps to a passing test"]
```

The orchestrator wires the support module into `app.ts`/composition, the `support` queue into `worker-registry.ts`, the routes into `apps/web/src/app/router.tsx`, **Help** into `customerNav` (rail above the shield, 5th mobile tab, `activeSection` for `/support`), **Support** into `staffNav` (second, with the badge from `useSupportWaitingCount`), the seed entry point, and the test-only hooks. At most 4 packages run at once: WP-1–WP-4 start together; WP-5–WP-7 start as WP-1 and WP-2 finish.

## 17. Implementation notes
_Filled in by /build-requirement: FR → test files, AJ → Playwright specs, sign-off per wave, decisions on gaps._
