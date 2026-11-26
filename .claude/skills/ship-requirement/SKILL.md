---
name: ship-requirement
model: opus
description: Release built work to production (k3s on the founder's own server, ADR 0022) safely. It checks that CI is green and the tree is clean, gets the founder's explicit OK, backs up MySQL, starts the approved GitHub Actions deploy (backup, migrate job, rollout, smoke test), can roll back with kubectl, and records release notes and roadmap status. It also walks through the one-time server setup. Use this whenever the user wants to deploy, release, ship, go live, publish to production, or roll back, including "ship prd-x", "deploy to the server" or "deploy to Kubernetes".
---

# Ship Requirement

Get built work in front of real users without breaking what's already there. Shipping should be boring and repeatable: the same steps every time, a backup before every migration, and a rollback that takes a minute.

**Deploying is outward-facing and hard to undo.** Never start a production deploy without the founder's explicit "yes" in this conversation. GitHub enforces it too: the `production` environment has the founder as required reviewer, so the deploy job waits for their approval.

Read first: `docs/architecture/stack.md` (hosting facts), `docs/ops/kubernetes-setup.md` (how the server is set up and run), `deploy/k8s/` (the manifests), `.github/workflows/deploy-k8s.yml`, the PRD's §12 (release notes: migrations, flags, secrets) and `references/kubernetes.md` (commands).

**Never run `kubectl` against the server or SSH into it without asking first**: each call touches production. Read-only calls (`get`, `logs`, `describe`) still need one OK per session. Never print or paste secret values (`kubectl get secret -o yaml` is off limits).

## Environments
One k3s cluster on the founder's server (16 cores, 64 GB, 1 TB), **shared with another app**: Llyner Leads is the `llyner` namespace and has half of the server (`deploy/k8s/namespace/quota.yaml`). Never touch other namespaces. There is no staging yet; the local stack (`./dev up`, `./dev e2e`) is the rehearsal and the post-deploy smoke test is the gate.

**App Platform and the server run side by side until the server is proven** (setup guide steps 6–7). First check which phase it is: the GitHub variable `PRE_CUTOVER` (`gh variable list --env production`) and where `leads.llyner.com` points (`dig +short leads.llyner.com`). Say which one is live.
- **Side by side** (`PRE_CUTOVER` is `true`, DNS points at App Platform): App Platform is production and the server is a parallel copy on its own test database. **Ship every release to both, same SHA:** first `deploy.yml` (App Platform, live: backups, deploy and rollback as in `references/app-platform.md`), then `deploy-k8s.yml` (the server). The live release is the one that counts: if the server's deploy fails, App Platform's release still stands; report it and fix the server separately. Never copy live data or live keys (Stripe live, live SMTP) to the server before the switch: its worker would email and charge customers a second time.
- **After the switch** (`PRE_CUTOVER` is `false`, DNS points at the server): ship to the server only. App Platform stays archived as the fallback until step 8; don't deploy to it.
- `references/app-platform.md` has the App Platform commands for the side-by-side phase.

## 1. Preflight
(Side by side: do this once for the SHA; it covers both deploys.)
- **E2E before merging:** CI doesn't run Playwright. Run `./dev e2e` locally on the branch and merge into `main` only when it's green.
- **Clean tree:** `git status --porcelain` is empty, the work is merged into `main` and pushed. Note the commit SHA.
- **Green checks:** the CI run for that SHA passed (`gh run list --branch main --limit 5`). Run `./dev check` locally if anything changed since. Stop if anything is red.
- **Production image boots:** the boot check in `references/kubernetes.md` (build the `api` target, migrate, then `/api/health` and `/` against MySQL 8.4 and Valkey in Docker). This catches bundle errors that tests miss.
- **Migrations:** list the migrations that will run (new files in `apps/api/migrations/` since the live SHA: `kubectl -n llyner get deploy api -o jsonpath='{.spec.template.spec.containers[0].image}'` shows it). Flag destructive ones (dropping or renaming columns or tables). Those need expand-and-contract: add the new column, deploy, backfill, and remove the old one in a later release. Otherwise a rollback breaks.
- **Config:** new non-secret env vars go in `deploy/k8s/app/config.yaml` in the same change. New infrastructure secrets go into the `app-secrets` secret on the server, by the founder (`references/kubernetes.md`, "Add a secret"); the deployer account can't read or write secrets. Provider, Claude, SMTP and Stripe keys are Platform settings in the back office (ADR 0012): list the ones the founder must enter after the deploy.
- **Room on the server:** if the release raises requests or limits, check they still fit the quota (`kubectl describe quota -n llyner`). The quota is the founder's split with the other app; don't raise it without asking.

## 2. Ask for the go-ahead
Tell the founder in one short message: the SHA, what ships (in plain language), the migrations (and whether any are destructive), any settings they must enter, and the expected downtime (none: api and web roll one pod at a time behind readiness checks; the worker restarts, and runs in flight resume, FR-19). Wait for an explicit "yes".

## 3. Back up the database
Side by side: first check App Platform's managed backup is from the last 24 hours (`references/app-platform.md`, "Backups"); that's the live data. Then the server:
The deploy workflow backs MySQL up before it migrates (a Job from the `mysql-backup` CronJob) and stops if the backup fails. Before shipping, also check:
1. Last night's backup succeeded: `kubectl -n llyner get jobs` (the newest `mysql-backup-*` is `Complete`).
2. Its log says it was **copied off the server** ("copied … to offsite:"). If it says "WARNING: no backup-offsite secret", stop and tell the founder: a disk failure would lose the data and the backups (setup guide step 4).

No backup, no deploy.

## 4. Deploy
Side by side: first deploy App Platform (`gh workflow run deploy.yml --ref main`, `references/app-platform.md`), wait for it to go live and pass its smoke test, then deploy the server as below. The founder approves each run.
1. Start the workflow: `gh workflow run deploy-k8s.yml --ref main -f reason="<prd or summary>"`, then `gh run watch`.
2. It runs the full checks, builds and pushes `ghcr.io/sbarbosa115/viper-{api,web}:<sha>`, then waits on the `production` environment. Tell the founder to approve it (Actions → the run → Review deployments).
3. The deploy job applies `deploy/k8s/platform` (MySQL, Valkey, backups, ingress), runs the backup Job, runs the `migrate` Job (a failure stops the release and the old version keeps serving), applies `deploy/k8s/app` with the new tag, waits for each rollout, and smoke-tests against `SERVER_IP`.
4. **Smoke test** (the job does this; repeat by hand if it's unclear): `/api/health` returns 200 with `{"status":"ok"}` (database and cache), and `/`, `/terms`, `/robots.txt` and `/app/` return 200. Then log in at `/app` as a test user, and check the worker heartbeat in the back office.
5. Tell the founder it's live, with the URL and what to check. Watch Sentry and the logs (`kubectl -n llyner logs deploy/api` and `deploy/worker`) for about 10 minutes.

If the job fails before the rollout (backup, migrate), nothing changed for users: read the logs it printed, fix forward, deploy again. If a rollout hangs, `kubectl rollout status` times out and the old pods keep serving (`maxUnavailable: 0`).

## 5. Rollback
If the smoke test fails after going live, or the founder asks:
1. With the founder's OK: `kubectl -n llyner rollout undo deployment/api deployment/worker deployment/web`, then `rollout status` for each. `rollout history deployment/api` shows the releases (change-cause is the SHA).
2. Code rolls back; **the database doesn't**. If the failed release ran migrations the old code can't handle, restore the backup taken just before the release (`backup-pre-<sha7>-*`; "Restore a backup" in the setup guide). Confirm with the founder first, because writes made since are lost.
3. Side by side: roll back App Platform as in `references/app-platform.md` (it's the live one), and the server with the command above. After the switch, if the server itself is broken: "Going back" in setup guide step 7. Data written on the server since the switch is not on App Platform; say so.
4. Fix forward on a branch, then ship again.

Report exactly what was rolled back and what state the database is in.

## 6. Record
- PRD: status `Shipped`, with the release date and SHA in §17.
- `docs/product.md`: roadmap status `Shipped`.
- `CHANGELOG.md`: a user-facing entry (what's new, in plain language, saying **Llyner Leads**, never "Viper"). Draft release notes the founder could send to customers.
- Remind the founder when to read the PRD's success metrics (§3), for example "check research_run_completed conversion in 2 weeks".

## First deployment
Follow `docs/ops/kubernetes-setup.md` with the founder, step by step: hardening SSH, `server-setup.sh` (once per server) and `llyner-setup.sh`, the GitHub `production` environment (`KUBE_CONFIG`, `APP_URL`, `SERVER_IP`, `PRE_CUTOVER`), off-server backups, the first deploy, moving the data from App Platform, DNS, and retiring App Platform. The founder does every step that needs a login, a payment method or a secret. Record any choice that differs from `stack.md` there and in an ADR.
