# Running Llyner Leads on Kubernetes (k3s on our own server)

_Last updated: 2026-11-27._ How Llyner Leads runs on a single Ubuntu server with k3s: the one-time setup (also the recipe to rebuild the server from scratch) and day-to-day operations. Releases: `/ship-requirement`. Decision: ADR 0022. Releases: `.github/workflows/deploy.yml`.

## What runs where

One server (16 cores, 64 GB RAM, 1 TB SSD) running k3s, a lightweight single-node Kubernetes, **shared with other apps**: one cluster, one namespace per app (see [Sharing the server](#sharing-the-server-with-another-app)). Llyner Leads lives in the `llyner` namespace:

| Part | Kubernetes object | File |
|---|---|---|
| api (Fastify, `/api` and the public site at `/`) | Deployment, 2 replicas (0.5 CPU / 1 GiB each, up to 1.5 GiB) | `deploy/k8s/app/api.yaml` |
| worker (BullMQ) | Deployment, 1 replica (1 CPU / 2 GiB, up to 3 GiB). One on purpose: the outbox relay and schedulers assume a single consumer | `deploy/k8s/app/worker.yaml` |
| web (the SPA at `/app`, nginx) | Deployment, 2 replicas | `deploy/k8s/app/web.yaml` |
| migrations | Job, run before each rollout | `deploy/k8s/migrate/` |
| MySQL 8.4 | StatefulSet, 1 CPU, 8 GiB buffer pool (10 GiB reserved, up to 12 GiB), 150 GiB on the SSD | `deploy/k8s/platform/mysql.yaml` |
| Valkey 8 (`noeviction`, append-only file) | StatefulSet, 2 GB max memory (up to 3 GiB), 20 GiB on disk | `deploy/k8s/platform/valkey.yaml` |
| Backups | CronJob, nightly at 03:00 UTC and before every release, 30 days kept on a 150 GiB volume | `deploy/k8s/platform/backup.yaml` |
| Routing and TLS | Traefik (bundled with k3s), cert-manager with Let's Encrypt | `deploy/k8s/platform/ingress.yaml` |
| Llyner's share of the server and its isolation | ResourceQuota (half the server: 7 CPU and 24 GiB reserved, 30 GiB ceiling, 400 GiB disk), LimitRange, NetworkPolicy | `deploy/k8s/namespace/` |

Images are built by GitHub Actions and stored in GitHub's container registry: `ghcr.io/sbarbosa115/viper-api` and `ghcr.io/sbarbosa115/viper-web`, tagged with the commit SHA.

**The risk to keep in mind:** this is one machine. If its disk dies, the database dies with it. The off-server backup (step 4) is not optional in practice.

## Before you start
- The server's public IP, and SSH access as a user with `sudo`.
- A GitHub **classic** personal access token with only `read:packages` (Settings > Developer settings > Personal access tokens > Tokens (classic)). The cluster uses it to pull the private images.
- An S3-compatible bucket for off-server backups: DigitalOcean Spaces, AWS S3 or Backblaze B2. An access key that can write to it.
- When rebuilding with existing data: the `SETTINGS_ENCRYPTION_KEY` and `SESSION_SECRET` from your password manager (saved in step 2). Without the same encryption key, every provider key saved in Platform settings becomes unreadable; without the same session secret, everyone has to log in again.

## Step 1. Harden SSH (5 minutes)
On the server:
```bash
sudo adduser deploy && sudo usermod -aG sudo deploy     # if you only have root
# from your machine: ssh-copy-id deploy@<server-ip>
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl reload ssh
```
Check you can still log in with your key in a second terminal before closing the first.

## Step 2. Set up the server and Llyner's namespace (15 minutes)
Copy the `deploy/` folder to the server:
```bash
scp -r deploy deploy@<server-ip>:~
ssh deploy@<server-ip>
```

**2a. The server, once for all apps** (skip if another app already did it):
```bash
sudo PUBLIC_HOST=<server-ip> ACME_EMAIL=<your email> bash deploy/server/server-setup.sh
```
It updates Ubuntu and turns on automatic security updates and fail2ban; opens the firewall for SSH, 80, 443 and 6443 (the Kubernetes API, for GitHub Actions); installs k3s with 1 CPU and 2 GiB reserved for the system; makes Traefik keep the visitor's real IP (the api's sign-up and log-in limits depend on it); and installs cert-manager with a Let's Encrypt issuer that every app shares.

Check: `sudo kubectl get nodes` shows the server `Ready`.

**2b. Llyner Leads' namespace.** Prefix the command with a space so the token isn't kept in shell history. Leave out the `SETTINGS_ENCRYPTION_KEY` / `SESSION_SECRET` line on a brand-new install; when rebuilding from a backup, pass the saved ones, because the restored data only works with the same keys.
```bash
 sudo PUBLIC_HOST=<server-ip> GHCR_USER=sbarbosa115 GHCR_TOKEN=<read:packages token> \
      SETTINGS_ENCRYPTION_KEY='<saved key>' SESSION_SECRET='<saved secret>' \
      bash deploy/server/llyner-setup.sh
```
It:
1. Creates the `llyner` namespace with its quota, default limits and network isolation (`deploy/k8s/namespace/`).
2. Generates the MySQL, Valkey and app secrets (random passwords; a new `SESSION_SECRET` and `SETTINGS_ENCRYPTION_KEY` unless you passed them).
3. Adds the pull secret for the private images.
4. Creates a `deployer` account limited to the `llyner` namespace that **cannot read secrets or change the quota**, and writes its kubeconfig to `/root/llyner-deployer.kubeconfig.b64`.

**Save the `SETTINGS_ENCRYPTION_KEY` and `SESSION_SECRET` in your password manager now** (the script prints the command). Re-running either script is safe: they never replace an existing secret.

Check: `sudo kubectl get nodes` shows the server `Ready`.

## Step 3. Configure GitHub (5 minutes)
GitHub > the `viper` repo > Settings > Environments > `production` (it already exists, with you as the required reviewer):
- **Secret** `KUBE_CONFIG`: the contents of `/root/llyner-deployer.kubeconfig.b64` (`sudo cat` it on the server). Then delete the file: `sudo shred -u /root/llyner-deployer.kubeconfig.b64`.
- **Variable** `APP_URL`: `https://leads.llyner.com`
- **Variable** `SERVER_IP`: the server's public IP. The smoke test always checks this server, even before DNS points at it.

## Step 4. Off-server backups (10 minutes)
Create the secret on the server (example for DigitalOcean Spaces in nyc3; for AWS use `RCLONE_CONFIG_OFFSITE_PROVIDER=AWS` and the region's endpoint):
```bash
 sudo kubectl -n llyner create secret generic backup-offsite \
  --from-literal=RCLONE_CONFIG_OFFSITE_TYPE=s3 \
  --from-literal=RCLONE_CONFIG_OFFSITE_PROVIDER=DigitalOcean \
  --from-literal=RCLONE_CONFIG_OFFSITE_ENDPOINT=nyc3.digitaloceanspaces.com \
  --from-literal=RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=<key> \
  --from-literal=RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=<secret> \
  --from-literal=BACKUP_REMOTE_PATH=<bucket>/mysql
```
Set a lifecycle rule on the bucket to delete files older than 30 days. Copies on the server are kept for 30 days in the `mysql-backups` volume.

## Step 5. First deploy (15 minutes)
Actions > **Deploy** > Run workflow on `master`. It:
1. Runs the full checks (`ci.yml`): lint, typecheck, tests, build, audit.
2. Builds and pushes the two images, tagged with the commit SHA.
3. **Waits for your approval** (the `production` environment).
4. Applies MySQL, Valkey, backups and routing; waits for MySQL and Valkey to be ready.
5. Backs up MySQL, then runs migrations. If the migration fails, the release stops and the previous version keeps running.
6. Rolls out api, worker and web, then smoke-tests `/api/health`, `/`, `/terms`, `/robots.txt` and `/app/` on the server.

The first time it pushes, GitHub creates the two packages as private. That's what you want; the `ghcr` pull secret from step 2 lets the cluster read them.

Check on the server: `sudo kubectl -n llyner get pods` shows everything `Running`.

Then point the `leads.llyner.com` DNS record (an **A record**) at the server's IP. Within a few minutes cert-manager gets the Let's Encrypt certificate: `sudo kubectl -n llyner get certificate` shows `READY True`. Make yourself Staff after signing up at `/app`: `sudo kubectl -n llyner exec deploy/api -- node dist/scripts/staff.js grant <your email>`.

## History
Until 2026-11-27 Llyner Leads ran on DigitalOcean App Platform with managed MySQL and Valkey (ADR 0006). The server went live that day; there was no customer data to move, so DNS was pointed at it and App Platform, `llyner-mysql` and `llyner-valkey` were deleted (ADR 0022).

## Day-to-day operations
All on the server with `sudo` (or copy `/etc/rancher/k3s/k3s.yaml` to your machine, replacing `127.0.0.1` with the server IP, for full admin access).

| Task | Command |
|---|---|
| What's running | `kubectl -n llyner get pods` |
| api / worker logs | `kubectl -n llyner logs deploy/api -f`, `kubectl -n llyner logs deploy/worker -f` |
| Restart | `kubectl -n llyner rollout restart deploy/api deploy/worker` |
| Roll back the app | `kubectl -n llyner rollout undo deploy/api deploy/worker deploy/web` (migrations are not undone) |
| Release history | `kubectl -n llyner rollout history deploy/api` |
| Backup now | `kubectl -n llyner create job backup-manual-$(date +%s) --from=cronjob/mysql-backup` |
| List backups | `ls -lh /var/lib/rancher/k3s/storage/*mysql-backups*/` |
| MySQL shell | `kubectl -n llyner exec -it statefulset/mysql -- sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot viper'` |
| Disk use | `df -h /var/lib/rancher` |

### Restore a backup
Scale the app down so nothing writes during the restore, load the file, scale back up:
```bash
kubectl -n llyner scale deploy/api deploy/worker --replicas=0
gunzip -c <backup>.sql.gz | kubectl -n llyner exec -i statefulset/mysql -- \
  sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'
kubectl -n llyner scale deploy/api --replicas=2 && kubectl -n llyner scale deploy/worker --replicas=1
```
The dump includes `CREATE DATABASE viper`, so it restores into the same database. Practise this once on a copy before you need it.

### Upgrades
- **Ubuntu security patches** install automatically. Reboot monthly for kernel updates (`sudo reboot`; the site is down for about two minutes).
- **k3s**: every few months, `curl -sfL https://get.k3s.io | INSTALL_K3S_CHANNEL=stable sh -` re-run on the server upgrades in place. Take a backup first.
- **cert-manager**: re-apply the newer release manifest (see server-setup.sh) once or twice a year.

### Sharing the server with another app
The server runs **one** k3s cluster. A second app gets its own **namespace** in it, not a second cluster: two k3s installs on one machine would fight over ports 80, 443 and 6443 and double the system overhead. What the apps share and what they don't:

| Shared (set up once by `server-setup.sh`) | Per app (its own namespace) |
|---|---|
| k3s, the firewall, OS updates | its pods, database, queue and backups |
| Traefik on 80/443: it routes by host name, so each app has its own Ingress for its own domain | its secrets and image pull secret |
| cert-manager and the `letsencrypt` ClusterIssuer | its quota, default limits and network policy |
| the Kubernetes API on 6443 | its own `deployer` account and GitHub `KUBE_CONFIG` |

To add the other app:
1. Copy `deploy/k8s/namespace/` and `deploy/server/llyner-setup.sh` into its repo, change the namespace name, the secrets it needs and the quota.
2. Give its Ingress its own host name (two Ingresses can't claim the same host), and its own `redirect-https` Middleware in its namespace.
3. Give it its own MySQL (or Postgres) in its namespace rather than sharing Llyner's: the apps can then be backed up, restored and upgraded separately, and a mistake in one can't touch the other's data. For two small apps the cost is about 1 GiB of RAM.
4. Give it the same quota as Llyner. The server is split in two equal halves after the system's share:

   | | CPU reserved | RAM reserved / ceiling | Disk |
   |---|---|---|---|
   | Llyner Leads (`llyner`) | 7 | 24 / 30 GiB | 400 GiB |
   | The other app | 7 | 24 / 30 GiB | 400 GiB |
   | System (k3s, Traefik, cert-manager, OS, images) | 1–2 | about 3 GiB | about 200 GiB |

   Llyner reserves about 5 CPU and 18 GiB at peak, so each app has room to grow. The quotas stop a runaway process in one app from starving the other. To change the split later, edit both apps' `quota.yaml` and re-run their setup scripts.

Check how full the server is: `sudo kubectl describe node | sed -n '/Allocated resources/,/Events/p'` and `sudo kubectl describe quota -A`.

### Monitoring
Nothing watches the server by default. At minimum, add an external uptime check on `https://leads.llyner.com/api/health` (for example UptimeRobot or Better Stack, free tiers) and keep `SENTRY_DSN` set so errors reach Sentry.
