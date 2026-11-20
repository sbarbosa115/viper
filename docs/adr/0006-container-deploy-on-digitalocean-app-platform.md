# 0006. Deploy containers on DigitalOcean App Platform

- Status: Accepted
- Date: 2026-11-18

## Context
The research agent needs long-running background workers, a queue and exact scheduling, which shared cPanel hosting can't provide. The founder chose DigitalOcean.

## Decision
One App Platform app per environment with three components: `web` (static site), `api` (service) and `worker` (worker). The api and worker share one Docker image with different start commands. Migrations run as a pre-deploy job. Managed MySQL, Managed Caching (Valkey) and Spaces sit alongside. Staging is a second app.

## Alternatives considered
- cPanel: no persistent workers; process limits.
- A plain droplet with Docker Compose: cheaper but we'd own patching, TLS and scaling.
- Railway / Render: similar; DigitalOcean chosen by the founder.

## Consequences
Rollback is redeploying the previous image. `/ship-requirement` must be rewritten for App Platform before the first deploy.
