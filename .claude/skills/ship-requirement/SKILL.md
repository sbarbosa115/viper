---
name: ship-requirement
model: opus
description: Release built work to staging and then production on cPanel, safely. It runs the checks, builds the bundled API and the SPA, backs up the database, runs migrations, deploys a versioned release, smoke-tests it, can roll back, and records release notes and roadmap status. Use this whenever the user wants to deploy, release, ship, go live, publish to staging or production, or roll back, including "ship prd-x" or "deploy to cPanel".
---

# Ship Requirement

Get built work in front of real users without breaking what's already there. Shipping should be boring and repeatable: the same steps every time, a backup before every migration, and a rollback that takes a minute.

**Deploying is outward-facing and hard to undo, so confirm before each environment.** Never deploy to production without the user's explicit "yes" in this conversation.

Read first: `docs/architecture/stack.md` (hosting facts, domains), the PRD's §12 (release notes: migrations, flags, secrets), and `references/cpanel.md`.

## 1. Preflight
- **Branch state:** the work is merged (or the user picks the branch), the working tree is clean, and you have the commit SHA.
- **Checks:** `./dev check` (lint, typecheck, tests, e2e and build, all in Docker). Stop if any are red.
- **Build:** `./dev build`, then the bundle boot check inside a container: copy `apps/api/dist` to a temp directory, run it there with `./dev node`, and confirm `/api/health`.
- **Access:** check that SSH to the host works (`ssh <host> 'echo ok'`), and that the environment's variables and secrets from PRD §12 exist on the server. Ask the user for anything missing. Never put secrets in the repo or in chat logs.
- **Migrations:** list the migrations that will run. Flag destructive ones (dropping or renaming columns or tables). Those need the expand-and-contract pattern: add the new column, deploy, backfill, and remove the old one in a later release. Otherwise the previous release breaks during a rollback.

## 2. Deploy to staging (always first)
Following `references/cpanel.md`:
1. Upload `apps/api/dist` to `releases/<sha>/` and `apps/web/dist` to the staging document root.
2. **Back up the database:** `mysqldump --single-transaction --routines <db> | gzip > backups/<timestamp>-<sha>.sql.gz`.
3. Run the migrations from the new release: `node releases/<sha>/scripts/migrate.js`.
4. Point the `current` symlink at the new release and restart (`touch tmp/restart.txt`).
5. **Smoke test:** `/api/health` returns 200 with the DB OK, the SPA loads, and you log in as a staging test user. Run the Playwright journeys against staging if a staging test account exists (`BASE_URL=https://staging… ./dev e2e --grep @smoke`; the e2e script passes `BASE_URL` through).
6. Tell the user it's on staging, with the URL and what to check, and wait for their OK.

## 3. Deploy to production
Only after an explicit "yes". Same steps as staging, against production. Take the backup first; there are no exceptions. Afterwards, watch Sentry and the Passenger log for about 10 minutes, or ask the user to.

## 4. Rollback
If the smoke test fails or the user asks:
1. Point `current` back at the previous release and restart.
2. If the failed release ran migrations that the old code can't handle, restore the backup taken in this run. Confirm with the user first, because writes made since the backup are lost.

Report exactly what was rolled back.

## 5. Record
- PRD: status `Shipped`, with the release date and SHA in §17.
- `docs/product.md`: roadmap status `Shipped`.
- `CHANGELOG.md`: a user-facing entry (what's new, in plain language). Draft release notes the user could send to customers.
- Keep the last 5 releases on the server and the last 10 backups; delete older ones.
- Remind the user when to read the PRD's success metrics (§3), for example "check order_placed conversion in 2 weeks".

## First deployment
Walk the user through the one-time setup in `references/cpanel.md`: Node.js App per environment, databases and users, the staging subdomain, AutoSSL, the env file, cron jobs and SSH key access. Record any host-specific choices (subpath vs root mount, deploy method) as ADRs and in `stack.md`.
