# 0022. Run on k3s on our own server

- Status: Accepted
- Date: 2026-11-26

## Context
The founder decided to move off DigitalOcean App Platform onto Kubernetes, on an empty Ubuntu server they already have (16 cores, 64 GB RAM, 1 TB SSD), and to run MySQL and Valkey inside the cluster instead of DigitalOcean's managed clusters.

## Decision
- k3s (single-node Kubernetes) on the server, **shared with the founder's other small app**: one cluster, one namespace per app, never a second cluster on the same machine. Shared: k3s, Traefik, cert-manager (`deploy/server/server-setup.sh`). Per app: its namespace with a ResourceQuota (an equal half of the server each: 7 CPU, 24 GiB reserved, 30 GiB ceiling, 400 GiB disk), a LimitRange and a NetworkPolicy that blocks other namespaces (`deploy/k8s/namespace/`), its own database and queue, secrets and deployer account (`deploy/server/llyner-setup.sh`).
- Llyner's namespace is `llyner`. Manifests in `deploy/k8s` (Kustomize): `platform` (MySQL 8.4 and Valkey 8 StatefulSets on local-path storage, backups, ingress), `app` (api ×2, worker ×1, web ×2) and `migrate` (the migration Job).
- Routing as in ADR 0016 through k3s's bundled Traefik (`/api` and `/` to the api, `/app` to the SPA); TLS from Let's Encrypt via cert-manager. Traefik runs with `externalTrafficPolicy: Local` and the api reads the client address from `X-Real-Ip` (`CLIENT_IP_HEADER`).
- Images built by GitHub Actions and pushed to `ghcr.io/sbarbosa115/viper-{api,web}`, tagged with the commit SHA.
- Deploys stay manual and approved (ADR 0018): `.github/workflows/deploy.yml` (named `deploy-k8s.yml` until App Platform was retired) runs the checks, builds the images, waits for the `production` reviewer, backs up MySQL, migrates, rolls out and smoke-tests. GitHub uses a namespace-scoped `deployer` account that cannot read secrets.
- Infrastructure secrets are Kubernetes secrets created on the server by `deploy/server/llyner-setup.sh`, never in the repo. Provider keys stay in Platform settings (ADR 0012).
- MySQL is dumped nightly and before every release, kept 30 days on the server and copied to an S3-compatible bucket.

## Alternatives
- Stay on App Platform (ADR 0006, about $40/month): managed backups and patching, but not what the founder wants.
- DigitalOcean Kubernetes with the managed databases: keeps managed backups, about $70–95/month.
- Docker Compose on the server: simpler, but the founder asked for Kubernetes.

## Consequences
- Supersedes ADR 0006. Amends ADR 0002 and ADR 0008 (MySQL and Valkey are no longer DigitalOcean-managed) and ADR 0018 (the deploy target changes, the approval gate stays).
- One machine is a single point of failure: a disk or host failure takes the app down, and recovery depends on the off-server backups. Restores must be practised.
- We now own OS patching (automatic security updates), k3s and cert-manager upgrades, MySQL tuning and monitoring.
- App Platform stays live while the server is proven: both get every release, each with its own database; the server never gets live data or live keys before the switch, so customers aren't emailed or charged twice. One switch (maintenance mode, dump and load, DNS, archive App Platform) moves production; App Platform is deleted two weeks later. Guide: `docs/ops/kubernetes-setup.md`.
- 2026-11-27: the server went live (there was no customer data to move) and App Platform, `llyner-mysql` and `llyner-valkey` were deleted, along with `.do/app.yaml`, the App Platform workflow and `docs/ops/digitalocean-setup.md`.
