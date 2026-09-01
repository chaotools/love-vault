#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?Usage: container-smoke.sh <image>}"
USER_ID='3aa6dbfc-a08c-4f27-9b13-96ee1891cb7c'
SERVICE_TOKEN='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
SESSION_SECRET='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
VAULT_KEY='cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
CONTAINER="love-vault-ci-${GITHUB_RUN_ID:-local}-${RANDOM}"
FIXTURE="$(mktemp -d)"
RUNNER_UID="$(id -u)"
RUNNER_GID="$(id -g)"

cleanup() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    docker logs "$CONTAINER" 2>/dev/null || true
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if [ -d "$FIXTURE" ]; then
    docker run --rm --user root -v "$FIXTURE:/fixture" "$IMAGE" \
      chown -R "$RUNNER_UID:$RUNNER_GID" /fixture >/dev/null 2>&1 || true
  fi
  rm -rf -- "$FIXTURE"
  exit "$status"
}
trap cleanup EXIT

# Reproduce the current production layout: an older root-running container
# created the user vault and its JSON files as root:root with 0755/0644 modes.
USER_DIR="$FIXTURE/data/users/$USER_ID"
mkdir -p "$USER_DIR/media" "$USER_DIR/thumbs" "$USER_DIR/music"
printf '%s\n' '{"title":"Before CI write","ai":{"apiKey":""}}' > "$USER_DIR/config.json"
docker run --rm --user root -v "$FIXTURE/data:/app/data" "$IMAGE" \
  chown -R root:root /app/data
docker run --rm --user root -v "$FIXTURE/data:/app/data" "$IMAGE" \
  chmod -R u=rwX,go=rX /app/data

docker run -d --name "$CONTAINER" \
  -p 127.0.0.1::3000 \
  -v "$FIXTURE/data:/app/data" \
  -e NODE_ENV=production \
  -e OPEN_BROWSER=0 \
  -e TRUST_PROXY=1 \
  -e MOBILE_SERVICE_TOKEN="$SERVICE_TOKEN" \
  -e WEB_SESSION_SECRET="$SESSION_SECRET" \
  -e AUTH_BROKER_URL=https://broker.example/api/love-vault \
  -e PUBLIC_ORIGIN=https://love.example \
  -e VAULT_ENC_KEY="$VAULT_KEY" \
  "$IMAGE" >/dev/null

PORT="$(docker port "$CONTAINER" 3000/tcp | head -n 1 | awk -F: '{print $NF}')"
for _ in {1..30}; do
  if curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/auth/status" >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/auth/status" >/dev/null

# Exercise the same atomic JSON write used by the web app and mini-program
# proxy. A container that cannot write the legacy bind mount must fail here.
curl --fail --silent --show-error \
  -X POST "http://127.0.0.1:$PORT/api/config" \
  -H 'Content-Type: application/json' \
  -H "X-Love-Vault-Service-Token: $SERVICE_TOKEN" \
  -H "X-Love-Vault-User-Id: $USER_ID" \
  --data '{"title":"CI write probe"}' >/dev/null

grep -q '"title": "CI write probe"' "$USER_DIR/config.json"
echo 'Container can read and atomically update a legacy production-style data volume.'
