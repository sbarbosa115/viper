#!/usr/bin/env bash
# Llyner Leads' own setup on the shared k3s server (run server-setup.sh first): namespace
# `llyner`, its resource quota and network isolation, secrets, the image pull secret, and the
# GitHub deployer account. Guide: docs/ops/kubernetes-setup.md. Run as root ON THE SERVER, from a
# copy of the repo's deploy/ folder:
#
#   sudo PUBLIC_HOST=<server public IP or DNS name> \
#        GHCR_USER=<github user> GHCR_TOKEN=<PAT with read:packages> \
#        [SETTINGS_ENCRYPTION_KEY=<existing key> SESSION_SECRET=<existing secret>  (when restoring data from a backup)] \
#        [SENTRY_DSN=<dsn>] bash deploy/server/llyner-setup.sh
#
# Safe to re-run: it never replaces an existing secret. It writes the kubeconfig for GitHub
# Actions (namespace-scoped, cannot read secrets) to /root/llyner-deployer.kubeconfig.b64.
set -euo pipefail

: "${PUBLIC_HOST:?set PUBLIC_HOST to the server public IP or DNS name}"
: "${GHCR_USER:?set GHCR_USER to the GitHub user that owns the read:packages token}"
: "${GHCR_TOKEN:?set GHCR_TOKEN to a GitHub token with read:packages}"
NS=llyner
HERE=$(cd "$(dirname "$0")" && pwd)

[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
say() { printf '\n==> %s\n' "$*"; }
rand() { openssl rand -base64 "$1" | tr -d '\n/+=' | cut -c1-"$2"; }
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
command -v k3s >/dev/null || { echo "run server-setup.sh first"; exit 1; }

say "Namespace $NS and secrets (existing secrets are kept)"
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -
say "Namespace guardrails: quota, default limits, isolation from other apps"
kubectl apply -k "$HERE/../k8s/namespace"
has() { kubectl -n "$NS" get secret "$1" >/dev/null 2>&1; }

if ! has mysql; then
  kubectl -n "$NS" create secret generic mysql \
    --from-literal=root-password="$(rand 48 32)" --from-literal=password="$(rand 48 32)"
fi
if ! has valkey; then
  kubectl -n "$NS" create secret generic valkey --from-literal=password="$(rand 48 32)"
fi
if ! has app-secrets; then
  db_pass=$(kubectl -n "$NS" get secret mysql -o jsonpath='{.data.password}' | base64 -d)
  vk_pass=$(kubectl -n "$NS" get secret valkey -o jsonpath='{.data.password}' | base64 -d)
  key="${SETTINGS_ENCRYPTION_KEY:-$(openssl rand -base64 32)}"
  kubectl -n "$NS" create secret generic app-secrets \
    --from-literal=DATABASE_URL="mysql://viper:${db_pass}@mysql:3306/viper" \
    --from-literal=REDIS_URL="redis://:${vk_pass}@valkey:6379" \
    --from-literal=SESSION_SECRET="${SESSION_SECRET:-$(rand 96 64)}" \
    --from-literal=SETTINGS_ENCRYPTION_KEY="$key" \
    --from-literal=SENTRY_DSN="${SENTRY_DSN:-}"
  if [ -z "${SETTINGS_ENCRYPTION_KEY:-}" ]; then
    echo "!! A NEW SETTINGS_ENCRYPTION_KEY was generated. Save a copy in your password manager now:"
    echo "   kubectl -n $NS get secret app-secrets -o jsonpath='{.data.SETTINGS_ENCRYPTION_KEY}' | base64 -d"
  fi
fi
kubectl -n "$NS" create secret docker-registry ghcr --docker-server=ghcr.io \
  --docker-username="$GHCR_USER" --docker-password="$GHCR_TOKEN" --dry-run=client -o yaml | kubectl apply -f -

say "Deployer account for GitHub Actions (namespace $NS only, no access to secrets)"
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata: { name: deployer, namespace: $NS }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: deployer, namespace: $NS }
rules:
  - apiGroups: ['']
    resources: [configmaps, services, persistentvolumeclaims, pods, pods/log, events]
    verbs: [get, list, watch, create, update, patch, delete]
  - apiGroups: [apps]
    resources: [deployments, statefulsets, replicasets]
    verbs: [get, list, watch, create, update, patch, delete]
  - apiGroups: [batch]
    resources: [jobs, cronjobs]
    verbs: [get, list, watch, create, update, patch, delete]
  - apiGroups: [networking.k8s.io]
    resources: [ingresses]
    verbs: [get, list, watch, create, update, patch, delete]
  - apiGroups: [traefik.io]
    resources: [middlewares]
    verbs: [get, list, watch, create, update, patch, delete]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: deployer, namespace: $NS }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: deployer }
subjects: [{ kind: ServiceAccount, name: deployer, namespace: $NS }]
---
apiVersion: v1
kind: Secret
metadata:
  name: deployer-token
  namespace: $NS
  annotations: { kubernetes.io/service-account.name: deployer }
type: kubernetes.io/service-account-token
EOF
until kubectl -n "$NS" get secret deployer-token -o jsonpath='{.data.token}' | grep -q .; do sleep 1; done
token=$(kubectl -n "$NS" get secret deployer-token -o jsonpath='{.data.token}' | base64 -d)
ca=$(kubectl config view --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')
out=/root/llyner-deployer.kubeconfig.b64
tmp=$(mktemp)
cat > "$tmp" <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: llyner
    cluster: { server: "https://$PUBLIC_HOST:6443", certificate-authority-data: $ca }
users:
  - name: deployer
    user: { token: $token }
contexts:
  - name: llyner
    context: { cluster: llyner, user: deployer, namespace: $NS }
current-context: llyner
EOF
umask 077
base64 -w0 "$tmp" > "$out"
shred -u "$tmp"

say "Done"
cat <<EOF
Next (docs/ops/kubernetes-setup.md):
  1. GitHub > Settings > Environments > production > add secret KUBE_CONFIG with the contents of
     $out   (then delete that file: shred -u $out)
  2. Point DNS for leads.llyner.com at this server (step 5).
  3. Run Actions > Deploy > Run workflow.
EOF
