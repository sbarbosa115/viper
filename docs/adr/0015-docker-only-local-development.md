# 0015. Docker is the only local runtime

- Status: Accepted
- Date: 2026-11-19
- Extends: ADR 0005 (tests in Docker)

## Context
The founder develops on Windows with WSL and wants every environment (developer machine, Claude's agents, CI) to behave the same, without installing Node or databases on the machine.

## Decision
The machine needs only Docker, bash and git. Every Node command (install, lint, typecheck, tests, e2e, dev servers, builds, one-off npm/npx) runs in a container through the `./dev` script at the repo root. Local development runs the whole stack in Docker Compose: api, worker, web, MySQL, Valkey and Mailpit. `node_modules` is installed into the bind-mounted repo by a container running as the WSL user, so editors see the types. CI runs the same `./dev` commands.

## Alternatives considered
- Node on the host plus Docker only for databases: faster single-file loops, but versions drift between machines and CI.
- Dev Containers: the same idea, but tied to an editor.

## Consequences
One way to run anything, identical locally, for agents and in CI. Each command pays a container start (about a second). Only one process may install dependencies at a time (the orchestrator).
