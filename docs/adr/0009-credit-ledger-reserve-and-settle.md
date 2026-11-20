# 0009. Credits: immutable ledger with reserve and settle

- Status: Accepted
- Date: 2026-11-18

## Context
Customers pay with prepaid credits, and each run must cost exactly what it used. Runs execute concurrently and can fail halfway.

## Decision
The Credit wallet balance is derived from an append-only ledger (grant, purchase, reservation, settlement, release, adjustment). Starting a run reserves its budget in a transaction that fails if the balance is too low. Every Tool call is metered at Rate card prices; when the run ends, it settles the real cost and releases the rest. Stripe webhooks add purchases idempotently (keyed by the Stripe event ID). Credits are integers (no fractions); fractional tool prices accumulate per run and round up once at settlement.

## Consequences
Balances are auditable and never go negative. Cost per lead is computed from the same records.
