#!/usr/bin/env bash
set -euo pipefail

ROOT=/srv/love-vault
SOURCE="$ROOT/data"
DEST="$ROOT/backups"
ENV_FILE="$ROOT/.env"

test -d "$SOURCE"
test -f "$ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE in /srv/love-vault/.env}"

mkdir -p "$DEST"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp "$DEST/love-vault-$stamp.XXXXXX.tar.gz")"
final="$DEST/love-vault-$stamp.tar.gz.enc"
trap 'rm -f "$tmp"' EXIT

tar -C "$ROOT" -czf "$tmp" data
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -in "$tmp" -out "$final" -pass env:BACKUP_PASSPHRASE
rm -f "$tmp"
trap - EXIT

# 保留最近 30 个本地加密备份。
find "$DEST" -maxdepth 1 -type f -name 'love-vault-*.tar.gz.enc' -printf '%T@ %p\n' |
  sort -nr | tail -n +31 | cut -d' ' -f2- | xargs -r rm -f
