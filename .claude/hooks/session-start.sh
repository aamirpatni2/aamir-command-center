#!/bin/bash
# SessionStart hook for Claude Code on the web: prepares a fresh cloud container so the
# API, worker, tests and e2e can run. Idempotent; safe to run on every session start.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
log() { echo "[session-start] $*" >&2; }

# 1. Dependencies (pnpm install is cached with the container snapshot).
log "installing dependencies"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --prefer-offline >/dev/null

# 2. PostgreSQL 16 + pgvector.
if ! ls /usr/share/postgresql/16/extension/vector.control >/dev/null 2>&1; then
  log "installing pgvector"
  (apt-get install -y postgresql-16-pgvector >/dev/null 2>&1) || log "WARN: could not install pgvector"
fi
if ! pg_lsclusters 2>/dev/null | grep -q online; then
  log "starting postgresql"
  service postgresql start >/dev/null
fi
psql_admin() { su postgres -c "psql -v ON_ERROR_STOP=1 -qtAc \"$1\""; }
if [ "$(psql_admin "select 1 from pg_roles where rolname='acc'")" != "1" ]; then
  log "creating database role"
  psql_admin "create role acc with login password 'acc_dev_password' createdb"
fi
for db in acc_dev acc_test; do
  if [ "$(psql_admin "select 1 from pg_database where datname='$db'")" != "1" ]; then
    log "creating database $db"
    su postgres -c "createdb -O acc $db"
  fi
  su postgres -c "PGOPTIONS='-c client_min_messages=warning' psql -qd $db -c 'create extension if not exists vector; create extension if not exists citext;'" >/dev/null
done

# 3. Redis for the task queue. Data dir /tmp so it never writes dump.rdb into a repo.
if ! redis-cli ping >/dev/null 2>&1; then
  log "starting redis"
  (cd /tmp && redis-server --daemonize yes --dir /tmp >/dev/null)
fi

# 4. Local .env for development (never committed). Real keys come from the environment settings.
if [ ! -f .env ]; then
  log "creating .env for local development"
  cp .env.example .env
  rand() { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(rand)|; s|^ACC_ENCRYPTION_KEY=.*|ACC_ENCRYPTION_KEY=$(rand)|" .env
  sed -i "s|^ACC_ENABLE_MOCKS=.*|ACC_ENABLE_MOCKS=true|; s|^WHATSAPP_APP_SECRET=.*|WHATSAPP_APP_SECRET=dev-local-secret|; s|^WHATSAPP_TRIAGE_DELAY_SECONDS=.*|WHATSAPP_TRIAGE_DELAY_SECONDS=3|" .env
fi

# 5. Apply database migrations to the dev database.
log "applying migrations"
mkdir -p data/uploads data/exports
pnpm db:migrate >/dev/null

log "ready: pnpm dev:api · pnpm dev:worker · pnpm dev:web · pnpm test"
