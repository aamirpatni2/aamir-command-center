#!/bin/bash
# Runs in the backup container: one pg_dump per day at BACKUP_AT (Pakistan time), plus one at
# start-up, into /backups. Old dumps beyond BACKUP_KEEP_DAYS are deleted.
set -uo pipefail
dump() {
  local file="/backups/acc-$(date +%Y%m%d-%H%M%S).dump"
  if pg_dump --format=custom --no-owner --file="$file.partial"; then
    mv "$file.partial" "$file"
    echo "[backup] wrote $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "[backup] FAILED" >&2
  fi
  find /backups -name 'acc-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -print -delete
}
dump
while true; do
  now=$(date +%s)
  next=$(date -d "today ${BACKUP_AT:-02:30}" +%s)
  [ "$next" -le "$now" ] && next=$(date -d "tomorrow ${BACKUP_AT:-02:30}" +%s)
  sleep $((next - now))
  dump
done
