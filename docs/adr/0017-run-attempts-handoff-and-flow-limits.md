# 0017. Runs survive failures through attempts, handoffs and leases; limits live on the Research flow

- Status: Accepted
- Date: 2026-11-19
- Amends: ADR 0008 (background agent), ADR 0011 (flows as data)

## Context
Research runs take up to an hour and call many providers. Workers crash, deploys restart them and providers fail. A retry must continue the work, not redo or re-charge it, and a new agent session has no memory of the previous one. Different markets will need different limits.

## Decision
- Each execution of a run is an attempt. After every Tool call the runner saves a handoff (step, items done and left, the agent's notes, last error, credits and time left) in the same transaction as the Tool call record.
- A new attempt starts a fresh agent session whose first prompt is built from the plan, the step goal and the handoff; stored Tool results are reused, never re-called or re-charged. Transcripts are kept for Staff, not replayed.
- Errors are retryable (crash, deploy, timeout, provider) or final (out of credits, provider not configured, invalid plan). A worker holds an attempt with a renewed lease; a sweeper ends attempts whose lease expired and queues the next one.
- Limits (active and total time, attempts, waits, stall timeout, step budgets and time limits, plan defaults) are settings on the Research flow, versioned with it and snapshotted by each run, within platform ceilings set in Settings.

## Consequences
Runs recover from crashes with at most one Tool call of lost work. Flow changes never affect runs in progress. Agent prompts must keep the handoff notes short and useful; the handoff schema is part of the research module's contract.
