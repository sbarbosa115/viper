# Kubernetes (k3s) commands

Every `kubectl` call below touches production: ask the founder before running it. Run them on the server with `sudo`, or locally with the admin kubeconfig the founder keeps. Always pass `-n llyner`: the cluster is shared with another app, never touch its namespace. Never print secret values.

## Layout
- Server: k3s, Traefik (ports 80/443), cert-manager with the `letsencrypt` ClusterIssuer, all shared (`deploy/server/server-setup.sh`).
- Namespace `llyner` (`deploy/server/llyner-setup.sh`): quota and isolation (`deploy/k8s/namespace/`), secrets `app-secrets`, `mysql`, `valkey`, `ghcr`, optional `backup-offsite`, and the `deployer` account GitHub uses (cannot read secrets).
- `deploy/k8s/platform`: MySQL and Valkey StatefulSets, the `mysql-backup` CronJob, the Ingress for `leads.llyner.com`.
- `deploy/k8s/app`: `api` (2), `worker` (1), `web` (2), ConfigMap `app-config`. `deploy/k8s/migrate`: Job `migrate`.
- GitHub: `.github/workflows/deploy-k8s.yml`; `production` environment with secret `KUBE_CONFIG` and variables `APP_URL`, `SERVER_IP`, `PRE_CUTOVER`.

## Boot check (preflight, local, no cloud)
Same as before the move: build the `api` target and boot it against MySQL 8.4 and Valkey in Docker.
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
docker build --target web -t viper-web:check .
docker rm -f boot-api boot-db boot-valkey; docker network rm viper-boot
```

## Deploy
```bash
gh workflow run deploy-k8s.yml --ref master -f reason="prd-x"
gh run watch        # founder approves the production environment
```
By hand (only if Actions is down, with the founder's OK, on the server): set `newTag` to an already pushed SHA in `deploy/k8s/app/kustomization.yaml` and `deploy/k8s/migrate/kustomization.yaml`, then
```bash
kubectl -n llyner create job backup-manual-$(date +%s) --from=cronjob/mysql-backup   # wait for Complete
kubectl -n llyner delete job migrate --ignore-not-found && kubectl apply -k deploy/k8s/migrate
deploy/server/wait-job.sh llyner migrate 900
kubectl apply -k deploy/k8s/app && kubectl -n llyner rollout status deploy/api
```

## Status and logs
```bash
kubectl -n llyner get pods -o wide
kubectl -n llyner get deploy api -o jsonpath='{.spec.template.spec.containers[0].image}'   # live SHA
kubectl -n llyner rollout history deploy/api
kubectl -n llyner logs job/migrate
kubectl -n llyner logs deploy/api -f          # also deploy/worker
kubectl -n llyner get events --sort-by=.lastTimestamp | tail -30
kubectl -n llyner describe quota               # room left in Llyner's half of the server
kubectl -n llyner get certificate              # TLS: READY True
```

## Backups
```bash
kubectl -n llyner get jobs | grep backup                      # newest mysql-backup-* Complete
kubectl -n llyner logs job/<backup-job> -c compress-and-ship  # "copied ... to offsite:"
kubectl -n llyner create job backup-manual-$(date +%s) --from=cronjob/mysql-backup
```
Restore: "Restore a backup" in `docs/ops/kubernetes-setup.md`.

## Rollback
```bash
kubectl -n llyner rollout undo deploy/api deploy/worker deploy/web
kubectl -n llyner rollout undo deploy/api --to-revision=<n>   # a specific release from rollout history
```

## Add a secret (the founder, on the server)
Never in chat. The founder runs, with a leading space so the shell doesn't keep it:
```bash
 sudo kubectl -n llyner patch secret app-secrets --type merge -p '{"stringData":{"NEW_KEY":"<value>"}}'
sudo kubectl -n llyner rollout restart deploy/api deploy/worker
```
