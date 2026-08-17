#!/usr/bin/env bash
set -euo pipefail

ROOT=/srv/love-vault
COMPOSE_FILE="$ROOT/docker-compose.yml"
ENV_FILE="$ROOT/.env"
RUNTIME_FILE="$ROOT/runtime.env"
PREVIOUS_FILE="$ROOT/previous-runtime.env"
TAG="${1:?Usage: release.sh <immutable-image-tag>}"

test -f "$ENV_FILE"
mkdir -p "$ROOT/data" "$ROOT/backups"

if [ -f "$RUNTIME_FILE" ]; then
  cp "$RUNTIME_FILE" "$PREVIOUS_FILE"
fi
printf 'LOVE_VAULT_TAG=%s\n' "$TAG" > "$RUNTIME_FILE"

rollback() {
  echo 'Deployment failed; restoring previous image tag.' >&2
  if [ -f "$PREVIOUS_FILE" ]; then
    cp "$PREVIOUS_FILE" "$RUNTIME_FILE"
    docker compose --env-file "$ENV_FILE" --env-file "$RUNTIME_FILE" -f "$COMPOSE_FILE" up -d --no-build
  fi
}
trap rollback ERR

docker compose --env-file "$ENV_FILE" --env-file "$RUNTIME_FILE" -f "$COMPOSE_FILE" pull
docker compose --env-file "$ENV_FILE" --env-file "$RUNTIME_FILE" -f "$COMPOSE_FILE" up -d --no-build --remove-orphans

for _ in {1..20}; do
  if curl --fail --silent --show-error http://127.0.0.1:3000/api/auth/status >/dev/null; then
    trap - ERR
    printf '%s %s\n' "$(date -u +%FT%TZ)" "$TAG" >> "$ROOT/releases.log"
    exit 0
  fi
  sleep 3
done

echo 'Love Vault health check timed out.' >&2
exit 1
