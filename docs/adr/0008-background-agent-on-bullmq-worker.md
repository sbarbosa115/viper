# 0008. Research runs as a background agent on a BullMQ worker

- Status: Accepted
- Date: 2026-11-18

## Context
A Research run takes 20–60 minutes, calls many providers, and must survive crashes and deploys. Users only see "working on it" and are told when results are ready.

## Decision
A Research run is a BullMQ job processed by the `worker` component. The run follows its Research flow one Step at a time. Inside each Step, a Claude agent loop plans its searches and calls only that Step's allowed Tools through the metered `ToolRunner`. A Checkpoint is saved after every Step, so a retried job resumes. Guardrails (credit budget, time limit) are enforced by the runner, not by the model. Event delivery uses an outbox table relayed to the queue.

*Amended 2026-11-20 (ADR 0019): Claude itself is called as a metered Tool through the `ToolRunner`, so Claude turns share the budget check, retries and stored-call reuse.*

## Alternatives considered
- One free-form agent over all tools: less predictable cost and behaviour.
- Fixed pipeline with no agent: can't adapt queries to what it finds.
- Hosted workflow engines (Temporal, Inngest): powerful, but another system to run or pay for.

## Consequences
Costs are predictable per Step; behaviour is testable with fake Tools. Queue and worker health become part of staff monitoring.
