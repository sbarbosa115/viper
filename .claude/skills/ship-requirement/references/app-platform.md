# App Platform commands

Every `doctl` or API call below touches the live account: ask the founder before running it. IDs come from `doctl apps list` and `doctl databases list`. Never echo secret values.

## Layout
- App `llyner-leads` (`.do/app.yaml`), region `nyc`: `api` service (`/` and `/api`), `web` static site (`/app`), `worker`, `migrate` pre-deploy job. All built from the root `Dockerfile` (the default stage is `api`; `web` sets `TARGET=web` at build time).
- Managed MySQL cluster `llyner-mysql` (database and user `viper`) and Managed Valkey cluster `llyner-valkey`, both attached in the spec so the app is a trusted source.
- GitHub: `.github/workflows/deploy.yml` (manual, `production` environment with a required reviewer). Repo secret `DIGITALOCEAN_ACCESS_TOKEN`; environment variable `DO_APP_ID`.

## Boot check (preflight, local, no cloud)
```bash
docker build --target api -t viper-api:check .
docker network create viper-boot
docker run -d --rm --name boot-db --network viper-boot -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=viper mysql:8.4
docker run -d --rm --name boot-valkey --network viper-boot valkey/valkey:8
# wait until: docker exec boot-db mysql -h127.0.0.1 -uroot -ptest -e 'SELECT 1' viper
ENV="-e DATABASE_URL=mysql://root:test@boot-db:3306/viper -e REDIS_URL=redis://boot-valkey:6379 \
  -e SESSION_SECRET=$(head -c 32 /dev/urandom | base64) -e SETTINGS_ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64) \
  -e APP_URL=http://localhost:3999"
docker run --rm --network viper-boot $ENV viper-api:check node dist/scripts/migrate.js
docker run -d --rm --name boot-api --network viper-boot -p 3999:3000 $ENV viper-api:check
curl -s localhost:3999/api/health   # {"status":"ok","checks":{"cache":"ok","database":"ok"}}
curl -s -o /dev/null -w '%{http_code}\n' localhost:3999/
timeout 10 docker run --rm --network viper-boot $ENV viper-api:check node dist/worker.js   # "worker started"
docker rm -f boot-api boot-db boot-valkey; docker network rm viper-boot
```

## Deploy
```bash
gh workflow run deploy.yml --ref master -f reason="prd-x"   # the ref must be the branch in .do/app.yaml
gh run watch                                               # founder approves the production environment
```
By hand (only if Actions is down, with the founder's OK): `doctl apps create-deployment <app-id> --wait`.

## Status and logs
```bash
doctl apps get <app-id>                                     # live URL, active deployment
doctl apps list-deployments <app-id>                        # history, newest first
doctl apps logs <app-id> migrate --type deploy --deployment <deployment-id>   # the migration job
doctl apps logs <app-id> api --type run --follow            # runtime logs (also worker)
```

## Backups
```bash
doctl databases backups <mysql-cluster-id>                  # daily automatic backups, kept 7 days
```
On-demand dump (founder's machine, its IP added to the cluster's trusted sources for the duration; connection details from the cluster's Overview page, entered by the founder):
```bash
docker run --rm -i -e MYSQL_PWD mysql:8.4 mysqldump -h <host> -P 25060 -u doadmin \
  --ssl-mode=REQUIRED --single-transaction --set-gtid-purged=OFF --routines viper | gzip > viper-<date>-<sha>.sql.gz
```
Keep dumps outside the repo (they contain customer data).

Restore to a point in time (creates a new cluster; then change `DATABASE_URL` and redeploy):
```bash
doctl databases fork llyner-mysql-restore --restore-from-cluster-id <mysql-cluster-id> \
  --restore-from-timestamp 2026-11-20T14:00:00Z
```

## Rollback
Control panel: App → Activity → **Rollback** next to the last good deployment (it shows a diff first). API:
```bash
curl -fsS -X POST -H "Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"deployment_id":"<good-deployment-id>"}' https://api.digitalocean.com/v2/apps/<app-id>/rollback/validate
curl -fsS -X POST -H "Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"deployment_id":"<good-deployment-id>","skip_pin":false}' https://api.digitalocean.com/v2/apps/<app-id>/rollback
# later, to unpin and go back to the latest spec:
curl -fsS -X POST -H "Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN" https://api.digitalocean.com/v2/apps/<app-id>/rollback/revert
```
The rollback redeploys the previous images and pins the app. It does not undo migrations (see SKILL.md §5).

## Changing the spec
`.do/app.yaml` has no secret values, so **never** `doctl apps update <app-id> --spec .do/app.yaml` directly: it would blank the secrets. Instead:
```bash
doctl apps spec get <app-id> > /tmp/live.yaml     # secrets appear as encrypted EV[...] values; keep them
# merge the change from .do/app.yaml into /tmp/live.yaml, review the diff with the founder
doctl apps spec validate /tmp/live.yaml
doctl apps update <app-id> --spec /tmp/live.yaml  # starts a deployment
rm /tmp/live.yaml
```
Or make the change in the control panel and mirror it in `.do/app.yaml`. Keep the two in sync.
