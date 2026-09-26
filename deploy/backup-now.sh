#!/bin/bash
# Take a backup right now (e.g. before an update): deploy/backups/acc-<time>-<label>.dump.
# Never overwrites an existing backup.
set -euo pipefail
cd "$(dirname "$0")"
label="${1:-manual}"
[[ "$label" =~ ^[a-z0-9-]+$ ]] || { echo "label: lowercase letters, digits and dashes only" >&2; exit 1; }
mkdir -p backups
file="acc-$(date +%Y%m%d-%H%M%S)-${label}.dump"
n=1
while [ -e "backups/$file" ]; do file="acc-$(date +%Y%m%d-%H%M%S)-${label}-$((n++)).dump"; done
docker compose exec -T backup pg_dump --format=custom --no-owner --file="/backups/$file.partial"
docker compose exec -T backup mv "/backups/$file.partial" "/backups/$file"
# Written by the container: deploy/backups may be owned by root (Docker creates bind-mount folders).
docker compose exec -T backup sh -c "echo '$file' > /backups/.last"
echo "✔ deploy/backups/$file"
