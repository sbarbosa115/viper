#!/usr/bin/env bash
# One-time setup of the shared server (Ubuntu 22.04 or 24.04): k3s, firewall, Traefik and
# cert-manager. Shared by every app on the server; each app then runs its own setup script
# (Llyner Leads: deploy/server/llyner-setup.sh). Guide: docs/ops/kubernetes-setup.md.
# Run as root ON THE SERVER:
#
#   sudo PUBLIC_HOST=<server public IP or DNS name> ACME_EMAIL=<email for certificate warnings> \
#        bash server-setup.sh
#
# Safe to re-run.
set -euo pipefail

: "${PUBLIC_HOST:?set PUBLIC_HOST to the server public IP or DNS name}"
: "${ACME_EMAIL:?set ACME_EMAIL to the address for certificate expiry warnings}"
K3S_CHANNEL="${K3S_CHANNEL:-stable}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.19.1}"

[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
say() { printf '\n==> %s\n' "$*"; }

say "System updates and automatic security patches"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq curl openssl ufw unattended-upgrades fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

say "Firewall: SSH, HTTP, HTTPS and the Kubernetes API (for GitHub Actions)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 6443/tcp
# k3s pod and service networks must reach each other through the host.
ufw allow from 10.42.0.0/16 to any
ufw allow from 10.43.0.0/16 to any
ufw --force enable

say "Traefik: keep the client's real IP (externalTrafficPolicy: Local)"
mkdir -p /var/lib/rancher/k3s/server/manifests
cat > /var/lib/rancher/k3s/server/manifests/traefik-config.yaml <<'EOF'
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |-
    service:
      spec:
        externalTrafficPolicy: Local
EOF

if ! command -v k3s >/dev/null; then
  say "Installing k3s ($K3S_CHANNEL channel)"
  curl -sfL https://get.k3s.io | INSTALL_K3S_CHANNEL="$K3S_CHANNEL" sh -s - server \
    --tls-san "$PUBLIC_HOST" --write-kubeconfig-mode 600 \
    --kubelet-arg=system-reserved=cpu=500m,memory=1Gi \
    --kubelet-arg=kube-reserved=cpu=500m,memory=1Gi \
    '--kubelet-arg=eviction-hard=memory.available<1Gi,nodefs.available<10%'
fi
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
until kubectl get nodes 2>/dev/null | grep -q ' Ready'; do sleep 3; done
kubectl get nodes -o wide

say "cert-manager $CERT_MANAGER_VERSION"
kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/$CERT_MANAGER_VERSION/cert-manager.yaml"
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=5m
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: $ACME_EMAIL
    privateKeySecretRef: { name: letsencrypt-account }
    solvers:
      - http01: { ingress: { ingressClassName: traefik } }
EOF


say "Done. Next: each app's own setup script (Llyner Leads: llyner-setup.sh)."
