---
name: ship-requirement
model: opus
description: Release built work to DigitalOcean App Platform safely. It checks that CI is green and the tree is clean, gets the founder's explicit OK, confirms a database backup, starts the approved GitHub Actions deploy (migrations run as a pre-deploy job), smoke-tests the live app, can roll back to the previous deployment, and records release notes and roadmap status. It also walks through the one-time App Platform setup. Use this whenever the user wants to deploy, release, ship, go live, publish to production, or roll back, including "ship prd-x" or "deploy to DigitalOcean".
---

# Ship Requirement

Get built work in front of real users without breaking what's already there. Shipping should be boring and repeatable: the same steps every time, a backup before every migration, and a rollback that takes a minute.

**Deploying is outward-facing and hard to undo.** Never start a production deploy without the founder's explicit "yes" in this conversation. GitHub enforces it too: the `production` environment has the founder as required reviewer, so the deploy job waits for their approval.

Read first: `docs/architecture/stack.md` (hosting facts), `docs/ops/digitalocean-setup.md` (how the app is set up), `.do/app.yaml` (the app spec), the PRD's §12 (release notes: migrations, flags, secrets) and `references/app-platform.md` (commands).

**Never run `doctl` or call the DigitalOcean API without asking first**: each call touches a live account. Read-only calls (`doctl apps get`, `list-deployments`, `databases backups`) still need one OK per session. Never print or paste secret values.

## Environments
One App Platform app, `llyner-leads` (production), built from the branch in `.do/app.yaml`. There is no staging app yet (the founder chose to start small). Until there is, the local stack (`./dev up`, `./dev e2e`) is the rehearsal, and the post-deploy smoke test is the gate. When a staging app is added, deploy and smoke-test it first, every time, and update this skill and `stack.md`.

## 1. Preflight
- **E2E before merging:** CI doesn't run Playwright. Run `./dev e2e` locally on the branch and merge into the deploy branch only when it's green.
- **Clean tree:** `git status --porcelain` is empty, the work is merged into the deploy branch (the `branch:` in `.do/app.yaml`), and it's pushed. Note the commit SHA.
- **Green checks:** the CI run for that SHA passed (`gh run list --branch <branch> --limit 5`). Run `./dev check` locally if anything changed since. Stop if anything is red.
- **Production image boots:** `docker build --target api .` and the boot check in `references/app-platform.md` (migrate, then `/api/health` and `/` against MySQL 8.4 and Valkey in Docker). This catches bundle errors that tests miss.
- **Migrations:** list the migrations that will run (new files in `apps/api/migrations/` since the live SHA). Flag destructive ones (dropping or renaming columns or tables). Those need expand-and-contract: add the new column, deploy, backfill, and remove the old one in a later release. Otherwise a rollback breaks.
- **Config:** new infrastructure env vars from PRD §12 exist on the app (names only: `doctl apps spec get` shows keys, never values). Provider, Claude, SMTP and Stripe keys are Platform settings in the back office (ADR 0012), not env vars: list the ones the founder must enter after the deploy.

## 2. Ask for the go-ahead
Tell the founder in one short message: the SHA, what ships (in plain language), the migrations (and whether any are destructive), any settings they must enter, and the expected downtime (none; App Platform swaps containers after the health check passes). Wait for an explicit "yes".

## 3. Back up the database
Managed MySQL takes a daily automatic backup (kept 7 days) and supports point-in-time restore. Before every deploy that runs migrations:
1. Check the latest automatic backup is from the last 24 hours (`references/app-platform.md`, "Backups").
2. If any migration is destructive or rewrites data, also take an on-demand dump (`mysqldump` in Docker, same file) and keep it outside the repo. If the founder's IP isn't a trusted source on the cluster, ask them to add it for the duration, then remove it.

No backup, no deploy.

## 4. Deploy
1. Start the workflow: `gh workflow run deploy.yml --ref <branch> -f reason="<prd or summary>"`, then `gh run watch`.
2. It runs the full checks, then waits on the `production` environment. Tell the founder to approve it (Actions → the run → Review deployments).
3. The job records the live deployment ID, runs `doctl apps create-deployment --wait` (App Platform builds the branch head, runs the `migrate` pre-deploy job, then swaps api, worker and web once `/api/health` passes), checks the built commit equals the checked SHA, and smoke-tests.
4. **Smoke test** (the job does this; repeat by hand if it's unclear): `/api/health` returns 200 with `{"status":"ok"}` (database and cache), and `/`, `/terms`, `/robots.txt` and `/app/` return 200. Then log in at `/app` as a test user, and check the worker heartbeat in the back office.
5. Tell the founder it's live, with the URL and what to check. Ask them, or watch yourself, Sentry and the runtime logs (`doctl apps logs <app-id> api --type run`) for about 10 minutes.

If a deploy fails before going live (a failed build, a failed migrate job or a red health check), App Platform keeps the previous deployment serving. Read the logs, fix forward, and deploy again.

## 5. Rollback
If the smoke test fails after going live, or the founder asks:
1. Find the previous good deployment: the deploy job prints it ("Live before this release"), or `doctl apps list-deployments <app-id>`.
2. With the founder's OK, roll back to it: App Platform → Activity → **Rollback**, or the API call in `references/app-platform.md`. This redeploys the previous images and **pins** the app (no new deploys) until the rollback is reverted or committed.
3. Code rolls back; **the database doesn't**. If the failed release ran migrations the old code can't handle, restore: point-in-time restore of the cluster to just before the deploy (it creates a new cluster; switch `DATABASE_URL` to it), or load the on-demand dump. Confirm with the founder first, because writes made since are lost.
4. Fix forward on a branch, then ship again; reverting the rollback unpins the app.

Report exactly what was rolled back and what state the database is in.

## 6. Record
- PRD: status `Shipped`, with the release date and SHA in §17.
- `docs/product.md`: roadmap status `Shipped`.
- `CHANGELOG.md`: a user-facing entry (what's new, in plain language, saying **Llyner Leads**, never "Viper"). Draft release notes the founder could send to customers.
- Remind the founder when to read the PRD's success metrics (§3), for example "check research_run_completed conversion in 2 weeks".

## First deployment
Follow `docs/ops/digitalocean-setup.md` with the founder, step by step: doctl auth, the MySQL and Valkey clusters, connecting GitHub, creating the app from `.do/app.yaml`, setting the secrets, the GitHub `production` environment with its reviewer, the first deploy, DNS for the domain, the first Staff user, and Platform settings. The founder does every step that needs a login, a payment method or a secret. Record any choice that differs from `stack.md` there and in an ADR.
