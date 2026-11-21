# ADR 0021: Support tickets as their own context

- Status: Accepted
- Date: 2026-11-21
- PRD: docs/prd-support.md

## Context
Customers need a way to ask for help inside Llyner Leads, and Staff need a desk to answer, with statuses, assignment, internal notes and emails both ways. The data (Tickets and their messages) belongs to no existing context: identity owns people and sessions, platform owns settings, audit and email sending, and reporting is read-only. The founder already runs a support desk on the sibling Llyner platform.

## Decision
- Add a **support** bounded context (`modules/support`, web `features/support`) that owns Tickets, Replies, Internal notes and the Waiting queue.
- It depends on identity (members, Staff, Business names), research (a Business's recent runs, one run's summary), billing (balance) and platform (Audit log, analytics, email through the outbox). Nothing depends on support.
- Copy the Llyner desk's model: statuses `open`, `in_progress`, `waiting_on_customer`, `closed`; take and assign; internal notes; a waiting queue, longest wait first; optimistic version checks on take, assign and status; a closed Ticket reopens on a reply within 30 days.
- Emails go through the outbox to a `support` worker queue, so an SMTP outage never fails a ticket action.
- Ticket text is customer-written data: plain text only, escaped everywhere, never treated as instructions.

## Consequences
- One more module and queue to wire, but no cycles and no changes to other contexts beyond small public queries and an optional `ticketNumber` on `acting_as.started`.
- Running both desks the same way keeps the founder's habits and makes MCP tools for the Viper desk a straightforward later step.
- No attachments or reply-by-email yet; adding them later needs Spaces and an inbound mail webhook (new ADRs).
