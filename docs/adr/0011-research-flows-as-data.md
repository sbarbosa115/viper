# 0011. Research flows are data, Tools are code

- Status: Accepted
- Date: 2026-11-18

## Context
Every customer starts with the default "Local buyers" flow, and different markets need different research. Adding a market must not require new code.

## Decision
Tools are code: one adapter per provider capability, with input/output schemas, a Rate card price and on/off control, managed by Staff. Research flows are data: ordered Steps, each with a goal, allowed Tools, a credit cap and a "done when" rule, stored in MySQL. Flow templates are rows Viper provides; a Business's own flow is a copy it edits, or a draft Claude writes from a description of the market.

*Amended 2026-11-19 (ADR 0017): a flow also carries its run limits, retry policy and per-step budgets and time limits, versioned and snapshotted by each run, within platform ceilings.*

## Consequences
New markets are configuration. Flow validation (only enabled Tools, caps within guardrails) lives in the research domain.
