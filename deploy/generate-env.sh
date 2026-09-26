#!/bin/bash
# Creates deploy/.env and deploy/app.env with fresh random secrets. Won't overwrite existing files.
set -euo pipefail
cd "$(dirname "$0")"
rand() { openssl rand -hex "${1:-32}"; }   # hex: safe inside connection URLs
if [ -e .env ] || [ -e app.env ]; then echo "deploy/.env or deploy/app.env already exists; not overwriting." >&2; exit 1; fi
domain="${DOMAIN:-}"
[ -n "$domain" ] || read -r -p "Domain for the dashboard (e.g. command.example.com): " domain
umask 077
cat > .env <<ENV
# Stack settings for docker compose. Keep this file private (chmod 600).
SITE_ADDRESS=${domain}
PUBLIC_URL=https://${domain}
POSTGRES_PASSWORD=$(rand 24)
APP_DB_ROLE=acc_app
APP_DB_PASSWORD=$(rand 24)
BACKUP_KEEP_DAYS=14
BACKUP_AT=02:30
ENV
sed -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(rand 32)|" -e "s|^ACC_ENCRYPTION_KEY=.*|ACC_ENCRYPTION_KEY=$(rand 32)|" app.env.example > app.env
echo "✔ wrote deploy/.env and deploy/app.env — now add your API keys to deploy/app.env"
