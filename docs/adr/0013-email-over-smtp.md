# 0013. Transactional email over SMTP configured in Platform settings

- Status: Accepted
- Date: 2026-11-19
- Amends: stack.md "Email" (previously: an HTTP email API)

## Context
The founder wants to supply SMTP credentials from their own email provider and change them from the back office.

## Decision
Send email with `nodemailer` over SMTP behind the `EmailSender` port. Host, port, user, password, TLS mode and sender come from Platform settings (ADR 0012). Emails are sent from the outbox by the worker with retries. Dev and e2e use Mailpit.

## Alternatives considered
- Provider HTTP APIs (Postmark, Resend): avoid SMTP port restrictions, but tie us to one provider's SDK.

## Consequences
DigitalOcean restricts some outbound mail ports, so the provider must accept a port that works from App Platform (2525 or 587); the Settings "Send test email" checks it. Switching to an HTTP API later is a new `EmailSender` adapter.
