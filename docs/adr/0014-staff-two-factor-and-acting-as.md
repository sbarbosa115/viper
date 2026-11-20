# 0014. Staff sign in with two-factor and can Act as a Business

- Status: Accepted
- Date: 2026-11-19

## Context
The founder needs a "super admin" who can see any customer's account exactly as the customer does, to support them and test the product. A Staff account can therefore read every customer's data.

## Decision
- Staff is a flag on a Member, granted only by a server command. Staff sessions require TOTP two-factor (`otplib`, secret encrypted per ADR 0012) before any back-office endpoint works.
- Acting as stores `acting_as_business_id` on the Staff session. The Actor then resolves to that Business's Owner with `actingAsStaffId` set, so every use case behaves as for the Owner. Use cases block changing email or password, buying credits and deleting the Business while Acting as.
- Acting as start/stop and every state-changing request made while Acting as are written to the Audit log.
- No banner, reason prompt, time limit or customer notification in the first version (founder's decision).

## Alternatives considered
- Read-only impersonation: safer, but the founder wants to do anything the customer can.
- Logging in with the customer's password: impossible to audit and requires knowing passwords.

## Consequences
One Actor model covers customers and Staff. The risk of acting in the wrong account is accepted; a banner and time limit are cheap to add later.
