# Deployment guide

From an empty server to a running Command Center on your own domain with HTTPS, nightly backups and least-privilege database access. Budget about one hour the first time.

Everything runs from one folder, `deploy/`, with Docker Compose:

| Service | What it does |
|---|---|
| `caddy` | HTTPS for your domain (certificates from Let's Encrypt, renewed automatically). The only thing reachable from the internet. |
| `api` | The API **and** the dashboard (same origin, strict Content-Security-Policy). |
| `worker` | Runs agent tasks, WhatsApp triage and automations. |
| `migrate` | Runs on every start: applies database migrations as the owner, then (re)grants the `acc_app` role the app uses. Exits when done. |
| `postgres` | PostgreSQL 16 with pgvector. Private network only. |
| `redis` | Task queue and rate-limit counters (persisted to disk). Private network only. |
| `backup` | A `pg_dump` at start-up and every night at 02:30 Pakistan time into `deploy/backups/`, kept 14 days. |

---

## 1. What you need

- **A server**: Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB disk is plenty to start. A region near Pakistan (Mumbai, Bangalore, Singapore, Dubai) keeps the dashboard snappy.
- **A domain or subdomain** you control, e.g. `command.yourdomain.com`.
- **Keys** (you can add them later; the dashboard shows each integration as "not configured" until then and never pretends it works):
  - `ANTHROPIC_API_KEY` — required for agents to do real work.
  - WhatsApp Cloud API: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (a random string you choose).
  - Optional: Google (`GOOGLE_CLIENT_ID/SECRET`), Canva (`CANVA_CLIENT_ID/SECRET`), Meta Ads read-only (`META_ADS_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`), web research (`BRAVE_API_KEY` or `TAVILY_API_KEY`), semantic search (`VOYAGE_API_KEY`).

## 2. Prepare the server

```bash
# As root on a fresh server
apt-get update && apt-get -y upgrade
curl -fsSL https://get.docker.com | sh            # Docker Engine + Compose plugin
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw allow 443/udp && ufw --force enable
adduser --disabled-password --gecos "" acc && usermod -aG docker acc
```

Log in as `acc` from now on. Use SSH keys, not passwords.

## 3. Point your domain at the server

At your DNS provider, add an **A record**: `command.yourdomain.com → <server IP>`. Wait until `ping command.yourdomain.com` shows the server's IP (usually minutes). Caddy can only get the certificate once this works.

## 4. Get the code and create the settings

```bash
git clone https://github.com/aamirpatni2/aamir-command-center.git
cd aamir-command-center/deploy
./generate-env.sh          # asks for the domain; writes .env and app.env with random secrets
nano app.env               # add your API keys (ANTHROPIC_API_KEY, WhatsApp, …)
```

Two files, both private (`chmod 600`, never committed):

- `deploy/.env` — stack settings read by Docker Compose: domain, database passwords, backup time. **The app never sees these.**
- `deploy/app.env` — the app's own secrets and API keys.

> **Write down `ACC_ENCRYPTION_KEY` (in `app.env`) in your password manager.** It encrypts the stored Google/Canva tokens. Database backups without it still restore everything else, but those connections would need reconnecting.

## 5. Start

```bash
docker compose up -d --build
docker compose ps          # api, worker, caddy, postgres, redis, backup: running; migrate: exited (0)
```

Open `https://command.yourdomain.com` — you should see the login page with a valid certificate.

Create your owner account (use a long, unique password; it isn't stored anywhere else):

```bash
docker compose run --rm --no-deps \
  -e OWNER_EMAIL=you@example.com -e OWNER_NAME="Aamir Patni" -e OWNER_PASSWORD='a-long-unique-passphrase' \
  api node --import tsx packages/database/scripts/create-owner.ts
```

Then remove that line from your shell history (`history -d $(history 1 | awk '{print $1}')`) and sign in. Add team members later from the API (`POST /api/users`) with their own accounts — never share logins.

## 6. Connect the integrations

| Integration | Where | What to enter |
|---|---|---|
| WhatsApp webhook | Meta for Developers → your app → WhatsApp → Configuration | Callback URL `https://<domain>/api/webhooks/whatsapp`, Verify token = your `WHATSAPP_VERIFY_TOKEN`; subscribe to `messages` |
| Google Workspace | Google Cloud Console → Credentials → OAuth client (Web) | Authorized redirect URI `https://<domain>/api/integrations/oauth/callback` |
| Canva | Canva Developers → your integration | Redirect URL `https://<domain>/api/integrations/oauth/callback` |

After changing `app.env`: `docker compose up -d` (restarts only what changed). The **Integrations** page shows what's configured and connected.

## 7. Backups

- Automatic: `deploy/backups/acc-<date>-<time>.dump`, one at start-up and one nightly at `BACKUP_AT` (02:30 Pakistan time), kept `BACKUP_KEEP_DAYS` (14).
- Before an update or a risky change: `./backup-now.sh` (never overwrites an existing file).
- **Copy backups off the server, encrypted.** A server that dies takes its disk with it. One simple option is [rclone](https://rclone.org) with a `crypt` remote on Google Drive, run nightly from cron:

  ```bash
  # once: rclone config → a "drive" remote, then a "crypt" remote on top of it named acc-backups
  # crontab -e:
  15 3 * * * rclone copy /home/acc/aamir-command-center/deploy/backups acc-backups: --max-age 48h
  ```

- **Restore** (replaces all current data; takes a safety backup first, validates the file, stops and restarts the app, re-applies migrations and grants):

  ```bash
  ./restore.sh backups/acc-20261001-023000.dump
  ```

- Test a restore every few months (CI already does it on every push). What's restored: everything in the database. What's not in the database dump: uploaded files in the `app-data` volume, and the two settings files — back those up too.

## 8. Updating

```bash
cd aamir-command-center && git pull
cd deploy && ./backup-now.sh before-update
docker compose up -d --build     # migrate runs first; api/worker restart after it succeeds
docker compose ps && docker compose logs --tail 50 api worker
```

Rolling back: `git checkout <previous tag or commit>`, then `docker compose up -d --build`. Migrations only move forward; if an update's migration changed data you need back, restore the `before-update` backup.

## 9. Day-to-day operations

| Task | Command (in `deploy/`) |
|---|---|
| Status | `docker compose ps` |
| Logs (live) | `docker compose logs -f api worker` |
| Restart the app | `docker compose restart api worker` |
| Health check | `curl https://<domain>/api/health` → `{"status":"ok","db":"ok"}` |
| Disk usage | `docker system df` and `du -sh backups` |
| Database shell (owner) | `docker compose exec postgres psql -U acc_owner -d acc` |

## 10. Security notes

- Only ports 80/443 (Caddy) and SSH are open. Postgres and Redis have no published ports.
- The app connects to Postgres as `acc_app`: it can read and write rows, but can't change the schema, truncate tables, or alter the audit log. The API and worker **refuse to start** if pointed at the owner or a superuser (override only with `ACC_ALLOW_OWNER_DB=true`, not recommended).
- Rate limits (Redis, survive restarts): `RATE_LIMIT_PER_MINUTE` per signed-in user (default 300), `LOGIN_IP_LIMIT` login attempts per IP per 15 minutes (default 30), 5 failed logins per IP + email per 15 minutes.
- Production refuses to start with placeholder secrets, `http://` URLs, identical session/encryption keys, or mock adapters enabled.
- Go-live checklist: [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) → "Manual checks before go-live".

## 11. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Browser shows a certificate error | DNS doesn't point at the server yet, or ports 80/443 are blocked. `docker compose logs caddy`. |
| `migrate` exited with an error | `docker compose logs migrate`. Usually a wrong `POSTGRES_PASSWORD` after the database volume was created with another one. |
| API logs "Refusing to start: … as superuser" | `DATABASE_URL` points at the owner. Use the compose file as shipped (it builds the app-role URL). |
| Agents fail with "no model configured" | `ANTHROPIC_API_KEY` is missing in `app.env`; add it and `docker compose up -d`. |
| WhatsApp messages don't arrive | Webhook URL/verify token in Meta; `WHATSAPP_APP_SECRET` must match the app's secret (signatures are checked). `docker compose logs api | grep webhook`. |
| "Too many requests" (429) | A burst over the per-user limit; wait a minute, or raise `RATE_LIMIT_PER_MINUTE` in `app.env`. |

## Managed alternative

The same image runs on Railway, Render or Fly with a managed Postgres (Neon or Supabase; enable the `vector` and `citext` extensions once as admin) and managed Redis (Upstash, with `noeviction`). Run `packages/database/scripts/migrate.ts` as a release command with `MIGRATION_DATABASE_URL` (owner) and `APP_DB_PASSWORD`, set `DATABASE_URL` to the `acc_app` role for the api and worker, set `WEB_DIST_DIR=/app/apps/web/dist`, and keep `NODE_ENV=production`.
