#!/bin/bash
# Run the whole Command Center on your own computer, the same way it runs on a server.
# Needs Docker Desktop (Windows / Mac) or Docker Engine (Linux). On Windows, run this from
# "Git Bash" (installed with Git for Windows):   cd aamir-command-center/deploy && ./start-local.sh
# First run: creates settings with fresh secrets, builds, starts, and asks for your owner account.
# Later runs: just starts it again (your data is kept). Stop with:  docker compose down
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null 2>&1 || { echo "✖ Docker isn't installed or not on PATH. Install Docker Desktop and try again." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "✖ Docker isn't running. Start Docker Desktop, wait until it says 'running', and try again." >&2; exit 1; }

if [ ! -f .env ]; then
  echo "→ First run: creating settings for https://localhost"
  DOMAIN=localhost ./generate-env.sh >/dev/null
  echo "  Settings: deploy/.env and deploy/app.env (private; add API keys to app.env any time)."
fi

echo "→ Building and starting (the first build takes a few minutes)…"
docker compose up -d --build --wait --wait-timeout 600

owners=$(docker compose exec -T postgres psql -U acc_owner -d acc -tAc "select count(*) from users where role = 'owner' and deleted_at is null" </dev/null | tr -d '[:space:]')
if [ "$owners" = "0" ]; then
  echo
  echo "→ Create your owner account"
  read -r -p "  Your name: " OWNER_NAME
  read -r -p "  Your email: " OWNER_EMAIL
  while true; do
    read -r -s -p "  Password (12+ characters): " OWNER_PASSWORD; echo
    read -r -s -p "  Repeat password: " again; echo
    [ "$OWNER_PASSWORD" = "$again" ] && [ ${#OWNER_PASSWORD} -ge 12 ] && break
    echo "  Passwords must match and be at least 12 characters. Try again."
  done
  export OWNER_NAME OWNER_EMAIL OWNER_PASSWORD
  docker compose run --rm --no-deps -T -e OWNER_NAME -e OWNER_EMAIL -e OWNER_PASSWORD api node --import tsx packages/database/scripts/create-owner.ts </dev/null
  unset OWNER_PASSWORD again
fi

echo
echo "✔ Running at https://localhost"
echo "  Your browser will warn about the certificate the first time: it's a certificate made on"
echo "  your own computer (not from the internet). Choose Advanced → Continue to localhost."
echo "  Stop:    docker compose down        (your data is kept)"
echo "  Backup:  ./backup-now.sh            (files in deploy/backups)"
