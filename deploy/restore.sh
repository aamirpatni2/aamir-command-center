#!/bin/bash
# Restore a backup into the running stack. DESTRUCTIVE: replaces all current data.
#   ./restore.sh backups/acc-20261001-023000.dump
set -euo pipefail
cd "$(dirname "$0")"
dump="${1:?usage: ./restore.sh backups/<file>.dump}"
[ -f "$dump" ] || { echo "no such file: $dump" >&2; exit 1; }
name=$(basename "$dump")
[ "$(dirname "$(realpath "$dump")")" = "$(realpath backups)" ] || { echo "the dump must be inside deploy/backups/" >&2; exit 1; }

# Check the file is a readable backup before touching anything.
docker compose exec -T backup pg_restore --list "/backups/$name" >/dev/null || { echo "not a valid backup: $name" >&2; exit 1; }

echo "This REPLACES all data in the database with $name."
if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  read -r -p "Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || { echo "cancelled"; exit 1; }
fi

echo "→ taking a safety backup of the current data first (never overwrites $name)"
./backup-now.sh before-restore
echo "→ stopping the app"
docker compose stop api worker
# Whatever happens next, bring the app back (a failed restore rolls back: the old data stays).
trap 'echo "→ starting the app"; docker compose start api worker >/dev/null' EXIT
echo "→ restoring"
docker compose exec -T backup pg_restore --clean --if-exists --no-owner --single-transaction --dbname=acc "/backups/$name"
echo "→ re-applying migrations and app-role grants"
docker compose run --rm migrate
echo "✔ restored $name"
