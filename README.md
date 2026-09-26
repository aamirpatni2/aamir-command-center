# Aamir AI Command Center

A personal multi-agent **AI Business Operating System** for running an AI education business: leads, WhatsApp,
students and courses, content, research, marketing, analytics and automations. An Orchestrator Agent sends work
to specialist agents, and a human approves anything that leaves the system.

> Status: **Milestone 8 complete** (+ Research Agent with verified sources, Knowledge base with approval and hybrid search). Previously: **Milestone 7 complete** (… Leads + scoring, WhatsApp inbox, courses/students/payments/certificates, Content Agent with review workflow and calendar). See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Quick start (local)

Requirements: Node 22+, pnpm 10+, and either Docker or local PostgreSQL 16 with pgvector.

```bash
pnpm install
cp .env.example .env            # set SESSION_SECRET, ACC_ENCRYPTION_KEY and ANTHROPIC_API_KEY
                                # (no key yet? ACC_ENABLE_MOCKS=true runs a labelled mock model in dev)
docker compose up -d            # Postgres (pgvector) + Redis
pnpm db:migrate
OWNER_EMAIL=you@example.com OWNER_NAME="Aamir" OWNER_PASSWORD='a-long-passphrase' pnpm db:create-owner
pnpm dev:api                    # http://localhost:4000/api/health
pnpm dev:worker                 # executes agent tasks from the Redis queue
pnpm dev:web                    # http://localhost:5173 — sign in with the owner account
pnpm test                       # needs the acc_test database (created by docker compose)
pnpm test:coverage              # same, with a coverage report in coverage/
E2E_EMAIL=... E2E_PASSWORD=... pnpm e2e   # browser smoke test (API + web must be running)
pnpm whatsapp:simulate --name "Ali" "Salam, fee kitni hai?"   # signed test message → real webhook (dev only)
```

![Dashboard](docs/screenshots/dashboard-desktop-sample-data.png)

Every push runs CI (GitHub Actions): typecheck, `pnpm security`, unit tests on Postgres + Redis, and the Playwright suite. No real API keys are used; agents run on the mock model.

## Deploying
On your own PC (Docker Desktop): `cd deploy && ./start-local.sh`, then open https://localhost. On a server: `cd deploy && ./generate-env.sh && docker compose up -d --build`. HTTPS, backups and least-privilege database access included. Step by step: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Docs
- [Architecture](docs/ARCHITECTURE.md) · [Decisions](docs/DECISIONS.md) · [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Security model](docs/SECURITY_MODEL.md) · [Agent architecture](docs/AGENT_ARCHITECTURE.md)
- [MCP architecture](docs/MCP_ARCHITECTURE.md) · [MCP servers](docs/MCP_SERVERS.md)
- [Database design](docs/DATABASE_DESIGN.md) · [API](docs/API.md) · [Deployment](docs/DEPLOYMENT.md)
