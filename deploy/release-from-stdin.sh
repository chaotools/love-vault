#!/usr/bin/env bash
set -euo pipefail

TAG="${1:?Usage: release-from-stdin.sh <immutable-image-tag>}"
IFS= read -r cnb_token
test -n "$cnb_token"

cleanup() {
  docker logout docker.cnb.cool >/dev/null 2>&1 || true
}
trap cleanup EXIT

printf '%s\n' "$cnb_token" | docker login docker.cnb.cool -u cnb --password-stdin >/dev/null
/srv/love-vault/release.sh "$TAG"
