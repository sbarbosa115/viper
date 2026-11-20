# DigitalOcean setup (Llyner Leads)

_Last updated: 2026-11-20._ How Llyner Leads runs on DigitalOcean App Platform, what it costs, and the one-time setup. For the founder and for Claude. Releases after setup: `/ship-requirement`.

**Start small:** one environment (production), deployed by hand after the founder approves each release. A staging app can be added later as a second copy of `.do/app.yaml`.

> `docs/architecture/stack.md` matches this setup: one environment and manual, approved deploys (ADR 0018).

## What runs where
| Piece | What | Size | Spec |
|---|---|---|---|
| `api` | App Platform service: the public site at `/` and the API at `/api` | 1 shared vCPU, 512 MiB (`apps-s-1vcpu-0.5gb`) | `.do/app.yaml` |
| `worker` | App Platform worker: BullMQ research and background jobs (`node dist/worker.js`) | 1 shared vCPU, 512 MiB | same image |
| `migrate` | Pre-deploy job: `node dist/scripts/migrate.js` before each release goes live | 512 MiB, billed only while it runs | same image |
| `web` | Static site: the SPA at `/app` | free | `TARGET=web` build |
| MySQL | Managed MySQL 8.4, `llyner-mysql`, NYC1 | 1 vCPU, 1 GiB, 10 GiB disk | attached in the spec |
| Valkey | Managed Valkey (Caching), `llyner-valkey`, NYC1 | 1 vCPU, 1 GiB | attached in the spec |

Region `nyc` for the app; the clusters must be in **NYC1**, the datacenter App Platform's `nyc` connects to over the private network.

## Choosing the database and queue: three options
Prices from DigitalOcean's pricing pages on 2026-11-20 ([App Platform](https://www.digitalocean.com/pricing/app-platform), [App Platform billing details](https://docs.digitalocean.com/products/app-platform/details/pricing/), [Managed Databases](https://www.digitalocean.com/pricing/managed-databases), [Droplets](https://www.digitalocean.com/pricing/droplets)). USD per month, before tax.

| | (a) Managed MySQL + managed Valkey | (b) Managed MySQL + self-run Valkey | (c) One Droplet, Docker Compose |
|---|---|---|---|
| api + worker containers | $5 + $5 | $5 + $5 | (on the Droplet) |
| SPA static site | $0 | $0 | (on the Droplet) |
| MySQL | $15.15 (1 GiB, 10 GiB disk, daily backups 7 days, point-in-time restore) | $15.15 | (on the Droplet) |
| Valkey | $15.00 (1 GiB) | $6.00 Droplet + $1.20 weekly backups | (on the Droplet) |
| Droplet | — | — | $24 (4 GiB, 2 vCPU) + $4.80 weekly backups. A $12 2 GiB Droplet is too tight for MySQL 8.4 + api + worker + Valkey |
| **Total** | **≈ $40.15** | **≈ $32.35** | **≈ $28.80** (≈ $14.40 on 2 GiB, not advised) |
| Who patches, backs up, renews TLS | DigitalOcean | DO for MySQL; you for the Valkey Droplet | you, for everything |
| Deploys and rollback | built in, one click | built in | your scripts over SSH; downtime on each deploy |
| Risk | lowest | the queue lives on a server nobody watches; private networking and a firewall to set up | one server: any failure takes everything down; backups and restores are yours to test |

Extra costs in every option: outbound transfer beyond 50 GiB per container ($0.02/GiB), and the migrate job's few seconds per deploy (cents a month).

Why not run Valkey inside App Platform as a cheap $5 container? App Platform containers have no persistent disk and are replaced on every deploy and restart, so the queue (research steps, emails, schedules) would be wiped each release. That isn't reliable enough for runs that must survive deploys (ADR 0017).

**Recommendation: (a), ≈ $40/month.** It's the setup the architecture already assumes (ADR 0006, ADR 0008, stack.md), it needs no server administration from a solo founder, and backups, restores and TLS are DigitalOcean's job. (b) saves about $8 a month for real ops work; (c) saves about $11 a month and brings back everything ADR 0006 rejected. If cost matters later, (b) is the first lever: move Valkey to a Droplet in the same VPC and change `REDIS_URL`.

Later, when there's revenue: a staging app (another ≈ $10 for its containers, sharing the MySQL cluster with a second database and needing its own Valkey or a Valkey database index), and a MySQL standby node.

## Versions checked
- **MySQL:** new Managed MySQL clusters are 8.4 only; 8.0 clusters are being force-upgraded to 8.4 from 30 October 2026 ([MySQL limits](https://docs.digitalocean.com/products/databases/mysql/details/limits), [8.0 end of life](https://docs.digitalocean.com/release-notes/upcoming/mysql-8-eol/)). Our `mysql:8.4` test and dev images match. No change needed.
- **Valkey:** Managed Valkey can be attached to an app (since April 2025, [release note](https://docs.digitalocean.com/notes/2025/valkey-app-platform-release)) with `engine: VALKEY` in the spec, but only as an existing cluster (`production: true`, `cluster_name`). App Platform's built-in dev databases are PostgreSQL only ([Manage databases](https://docs.digitalocean.com/products/app-platform/how-to/manage-databases/)). So the cluster is created separately first (step 3).

## One-time setup
Steps marked **Founder** need a login, a payment method or a secret; Claude guides but doesn't do them. Claude runs `doctl` only after asking.

1. **Founder: account.** A DigitalOcean account with a payment method, and admin rights on the GitHub repo.
2. **Founder: doctl.** Install `doctl` (a single binary, no Node needed) or use `docker run --rm -it -v ~/.config/doctl:/root/.config/doctl digitalocean/doctl`. Create a personal access token (API → Tokens, custom scopes: `app` and `database` read/write) and run `doctl auth init --context llyner`. Check with `doctl account get`.
3. **Founder: the clusters** (control panel → Databases → Create, region **NYC1**):
   - MySQL 8.4, Basic, 1 GiB / 1 vCPU / 10 GiB, name `llyner-mysql`. In **Users & Databases**, add database `viper` and user `viper`.
   - Valkey, Basic, 1 GiB, name `llyner-valkey`. In **Settings**, set the eviction policy to `noeviction` (BullMQ loses jobs under any other policy).
   - Leave trusted sources on: attaching the clusters in the app spec adds the app automatically.
4. **Founder: connect GitHub.** App Platform → Create App → GitHub → authorize DigitalOcean on this repo (that installs the DigitalOcean GitHub app). Cancel the wizard once the repo is listed.
5. **Claude: fill the spec.** In `.do/app.yaml`, replace `OWNER/viper` with the real repo, and set `branch:` to the branch to deploy (`main` by default). Commit and push.
6. **Create the app** (Claude, after asking): `doctl apps create --spec .do/app.yaml`. Note the app ID. The first deployment fails because the secrets are empty; that's expected.
7. **Founder: secrets.** App → Settings → App-Level Environment Variables, each one **Encrypted**:
   - `SESSION_SECRET`: `openssl rand -base64 48`
   - `SETTINGS_ENCRYPTION_KEY`: `openssl rand -base64 32`. **Also save it in a password manager outside DigitalOcean**: without it, every key in Platform settings is unreadable (ADR 0012).
   - `DATABASE_URL`: from the MySQL cluster's **private** connection details, user `viper`:
     `mysql://viper:<password>@<private-host>:25060/viper?ssl=%7B%22rejectUnauthorized%22%3Afalse%7D`
     The `ssl` part turns TLS on for `mysql2` (it ignores DigitalOcean's own `ssl-mode=REQUIRED`). It encrypts without checking the certificate, which is acceptable on the private network; verifying it needs a small code change (see "Follow-ups").
   - `REDIS_URL`: from the Valkey cluster's **private** connection details: `rediss://default:<password>@<private-host>:25061`
   - `SENTRY_DSN`: the Sentry project's DSN, or delete the variable to run without Sentry.
   Saving starts a new deployment.
8. **Founder: GitHub.** Repo → Settings → Environments → New `production`: required reviewer = the founder, deployment branches = the branch in the spec; add the environment variable `DO_APP_ID` (the app ID). Repo → Secrets → Actions: `DIGITALOCEAN_ACCESS_TOKEN`, a separate token with `app` read/update scope only.
9. **First deploy:** Actions → Deploy → Run workflow on that branch → approve. The job migrates, deploys and smoke-tests `/api/health`, `/`, `/terms`, `/robots.txt` and `/app/`. The app answers at its `https://<app>.ondigitalocean.app` URL.
10. **Founder: first Staff user.** Sign up at `/app` with the founder's email, then App → `api` → Console: `node dist/scripts/staff.js grant <email>`. Sign in again and set up two-factor (ADR 0014).
11. **Founder: Platform settings** (back office, as Staff): the Claude key and models, the data providers, SMTP, Stripe keys (webhook endpoint `https://<domain>/api/webhooks/stripe`) and the Google Analytics ID. Keys never go in env vars or the repo (ADR 0012).
12. **Founder: domain, when chosen.** App → Settings → Domains → Add, as the primary domain. Either point the domain's nameservers to DigitalOcean (simplest for the bare domain) or add the CNAME/ALIAS record App Platform shows at the registrar. TLS is automatic. `APP_URL` follows the primary domain by itself (`${APP_URL}`); redeploy once, then update the Stripe webhook URL and add the `domains:` block to `.do/app.yaml`.

## Changing the spec later
`.do/app.yaml` holds no secret values, so pushing it with `doctl apps update --spec` would blank the secrets. Use the merge procedure in `.claude/skills/ship-requirement/references/app-platform.md`, or change it in the control panel and mirror it in the file.

## Assumptions to confirm on the first deploy
- App Platform passes the static site's `BUILD_TIME` variable `TARGET=web` to `docker build` as a build argument and copies `output_dir` out of the built image. If the `web` build serves the api image instead, switch the static site to a plain build: drop `dockerfile_path` and `envs`, set `build_command: npm run build -w apps/web` and `output_dir: apps/web/dist`.
- Ingress picks the most specific prefix (`/api`, `/app`) over `/`; the rules are also listed in that order.
- Managed Valkey's certificate is accepted by `ioredis` with a plain `rediss://` URL. If the worker logs TLS errors, the CA needs passing in code (see "Follow-ups").

## Follow-ups (code, not done here)
- `apps/api/build.mjs`: the banner `import { createRequire } from 'module'` clashes with the `createRequire` import that `@sentry/node` 11 brings into the bundle, so `dist/main.js` and `dist/worker.js` crash at start (`Identifier 'createRequire' has already been declared`). Fix: alias it, `import { createRequire as __bannerCreateRequire } from 'module'; const require = __bannerCreateRequire(import.meta.url);`. Tested: the api then serves `/api/health`, `/` and `/terms`, and the worker starts. **This blocks the first deploy.**
- Optional `DATABASE_CA_CERT` (bound to `${db.CA_CERT}`) passed to `mysql2`'s `ssl.ca`, so TLS to MySQL is verified, and the same for Valkey if needed.
