#!/usr/bin/env bash
# Build & push Home Pot images to GHCR, then trigger Portainer redeploy.
#
# Usage:
#   ./scripts/deploy.sh           # build+push pwa only (the common case)
#   ./scripts/deploy.sh --all     # also rebuild db + kong-config images
#
# Required env (put these in ~/.zshrc or similar — not in the repo):
#   VITE_SUPABASE_ANON_KEY   Baked into PWA bundle at build time
#   PORTAINER_WEBHOOK        Redeploy trigger URL from the Portainer stack

set -euo pipefail

: "${VITE_SUPABASE_ANON_KEY:?Set VITE_SUPABASE_ANON_KEY (same as ANON_KEY in Portainer)}"
: "${PORTAINER_WEBHOOK:?Set PORTAINER_WEBHOOK (Portainer stack webhook URL)}"

REPO="${REPO:-ghcr.io/n3v3r3nds}"
PLATFORM="${PLATFORM:-linux/amd64}"
SITE_URL="${SITE_URL:-https://poker.sexyness.app}"

build_all=false
if [[ "${1:-}" == "--all" ]]; then
  build_all=true
fi

cd "$(dirname "$0")/.."

echo "▶ building pwa…"
docker buildx build --platform "$PLATFORM" \
  -f Dockerfile \
  --build-arg "VITE_SUPABASE_URL=$SITE_URL" \
  --build-arg "VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY" \
  -t "$REPO/home-pot-pwa:latest" \
  --push .

if $build_all; then
  echo "▶ building db…"
  docker buildx build --platform "$PLATFORM" \
    -f Dockerfile.db \
    -t "$REPO/home-pot-db:latest" \
    --push .

  echo "▶ building kong-config…"
  docker buildx build --platform "$PLATFORM" \
    -f Dockerfile.kong-config \
    -t "$REPO/home-pot-kong-config:latest" \
    --push .
fi

echo "▶ triggering Portainer redeploy…"
curl -fsS -X POST --max-time 60 "$PORTAINER_WEBHOOK" && echo
echo "✅ deploy triggered — check Portainer or: ssh server 'docker ps --filter name=home-pot'"
