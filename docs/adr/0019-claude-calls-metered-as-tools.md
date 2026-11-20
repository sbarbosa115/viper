# 0019. Claude calls are metered as Tools through the ToolRunner

- Status: Accepted
- Date: 2026-11-20
- Amends: ADR 0008 (background agent), ADR 0011 (Tools are code)

## Context
Claude is the largest single cost of a Research run, and the welcome chat and plan drafting also call it outside any run. G-3 needs provider cost recorded for every run, and a retried attempt must not pay twice for a Claude turn it already made. Calling Claude through a separate `LlmClient` would have needed its own metering, budget checks and reuse.

## Decision
- Claude is a Tool like any provider: one Tool per model role (`claude.fast`, `claude.planning`, `claude.chat`), each with a Rate card price per 1k input tokens, plus a companion `claude.<role>.out` priced per 1k output tokens. One call records both rows.
- Inside a run, the agent loop calls Claude only through the `ToolRunner`, so Claude turns get the same budget check, retries, stored-call reuse and metering as provider Tools. The research module holds no `LlmClient`.
- Outside runs (welcome chat, plan drafting), Claude calls are recorded as Tool calls with no run, through `LlmUsageMeter`. They are not charged to the Business.
- A Step lists the Claude Tool it runs on, so Staff can change a Step's model in the flow settings. Local buyers runs Steps 2, 6, 7 and 8 on the fast model and Score & pitch on the planning model.

## Alternatives considered
- A separate `LlmClient` with its own usage table: two metering paths, and Claude turns would not be reused on a retry.
- Charging per run step instead of per token: hides the real cost that G-3 measures.

## Consequences
The Rate card and Staff dashboard show Claude spend next to the other providers. Changing a model's price is a Rate card edit. Disabling a Claude Tool affects every Step that lists it, so Staff should treat the `claude.*` Tools as core.
