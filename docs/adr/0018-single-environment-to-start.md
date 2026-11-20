# 0018. Start with a single environment and manual, approved deploys

- Status: Accepted
- Date: 2026-11-20

## Context
The founder asked to start as small and cheap as possible. Separate staging and production apps would double the database and Valkey cost.

## Decision
- One App Platform app in NYC (`.do/app.yaml`): an api service at `/` and `/api`, a worker, a pre-deploy migration job, a static site at `/app`, and existing managed MySQL 8.4 and Valkey clusters (option (a) in `docs/ops/digitalocean-setup.md`, about $40/month).
- Deploys run only from `.github/workflows/deploy.yml` (manual), after the full checks pass and the founder approves it in the GitHub `production` environment.
- Valkey eviction policy must be `noeviction` (BullMQ).

## Alternatives
- Staging plus production apps: safer, but about twice the cost. Add them later.
- Valkey on a Droplet (about $32/month) or everything on one Droplet (about $29/month): cheaper, but needs server administration.

## Consequences
- No pre-production environment: the local Docker stack and e2e suite are the last check before production, so keep them green.
- Amends ADR 0006 (which assumed staging) and supersedes the auto-deploy plan from earlier on 2026-11-20.
