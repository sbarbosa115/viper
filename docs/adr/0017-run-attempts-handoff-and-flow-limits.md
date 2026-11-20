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

*Amended 2026-11-20 (found during the build):*
- *Lease: the stall timeout ("worker stopped after") defaults to 5 min with a minimum of 5, up from 2, because one provider call with its retries can take about 5 min and a shorter lease would end live attempts. A stalled attempt is now found within about 5.5 min.*
- *Provider calls run outside database transactions. Before the provider is called, the Tool call is stored as `started` in a short write of its own (migration `20261120100000_tool_calls_started`). After the call, its outcome (`ok` or `error`) is stored in the same transaction as the handoff. A row left `started` is a call whose worker stopped mid-call; the next attempt calls it again. This keeps long provider calls from holding a transaction or a row lock.*
- *Seeded Local buyers Step time limits are 2/12/1/4/12/6/5/6/10/2 min, adding up to the 60-min max active time. The server refuses Step time limits that add up to more than the max active time (`STEP_TIME_OVER_ACTIVE_TIME`).*
- *When the budget can't pay for the next Tool call, the run skips the remaining Steps and delivers what it found. It fails with `INSUFFICIENT_CREDITS` only when there is nothing to deliver.*

## Consequences
Runs recover from crashes with at most one Tool call of lost work (a call left `started` is made again). Flow changes never affect runs in progress. Agent prompts must keep the handoff notes short and useful; the handoff schema is part of the research module's contract.
