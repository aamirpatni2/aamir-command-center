# Architecture — Aamir AI Command Center

Version 1.0 · Status: Milestone 12 implemented

## 1. What this system is

A personal **AI Business Operating System** that runs on agents. One human operator
(Aamir) sends requests to an **Orchestrator Agent**. The Orchestrator plans the
work, hands it to **specialist agents**, and those agents reach the outside world
only through a **tool layer** (internal tools and MCP servers). Anything that
leaves the system or can't be undone goes through the **Approval Center** first.

```
Human (Aamir)
   │  web dashboard / API
   ▼
Command Center (apps/web  ─▶  apps/api)
   │  creates Task
   ▼
Orchestrator Agent  ── classify → plan → delegate → verify → summarise
   │
   ├─▶ Sales · WhatsApp · Content · Research · Student · Marketing · Analytics · Course agents
   │        │ (only through ToolRegistry with per-agent permissions)
   │        ▼
   │   Tools: internal DB tools │ MCP clients │ model providers
   │        ▼
   │   PostgreSQL · Redis · external services (WhatsApp, Google, Canva, Meta …)
   ▼
Results ─▶ Approval Center (when the action is external or irreversible) ─▶ Action ─▶ Audit log
```

## 2. Environment audit (Milestone 0, 2026-09-25)

| Item | Found | Notes |
|---|---|---|
| OS | Ubuntu 24.04.4 LTS, x86_64 (cloud container) | 4 vCPU, 15 GiB RAM |
| Node.js | v22.22.2 | LTS, native `fetch`, `node:test` also available |
| npm / pnpm | 10.9.7 / 10.33.0 | **pnpm workspaces** chosen |
| Git | 2.43.0 | |
| Claude Code | 2.1.282 | |
| Python | 3.11.15 | not used by this project |
| Docker | 29.3.1 | used for `docker-compose.yml` (Postgres + Redis) on dev machines |
| PostgreSQL | 16 (local cluster) | `pgvector 0.6` installed for RAG, `citext`, `pgcrypto` available |
| Redis | 7.x `redis-server` | job queue for the worker (Milestone 3+) |
| Project MCP config | none (`.mcp.json` absent) | created as docs only — no servers installed yet |
| Repository | `aamirpatni2/aamir-command-center` was **empty** | greenfield |
| Related repo | `aamirpatni2/sample` — Python "AI News Content Agent" (FastAPI + RSS + Claude → Facebook posts) | its news-fetch + Hinglish-post logic is a reference for the Research/Content agents (Milestones 7–8) |

## 3. Technology choices (see DECISIONS.md for the reasoning)

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) everywhere |
| Monorepo | pnpm workspaces |
| API | Fastify 5 + Zod validation |
| Web | React 19 + Vite + React Router + Tailwind CSS 4 (Milestone 2) |
| Worker | Node process + BullMQ on Redis (Milestone 3) |
| Database | PostgreSQL 16 + Drizzle ORM + drizzle-kit SQL migrations |
| Vector search | pgvector inside the same Postgres (no extra vector DB) |
| Auth | Server-side sessions (httpOnly cookie, hashed token in DB) + Argon2id passwords + RBAC |
| Models | `ModelProvider` interface; Anthropic adapter first, OpenAI/Google later |
| Integrations | MCP client layer behind a `ToolRegistry` |
| Tests | Vitest (unit + integration against a real `acc_test` database) |
| Logs | pino structured JSON logs + `audit_logs` + `agent_runs`/`agent_steps` tables |

## 4. Repository layout

```
apps/
  api/        Fastify HTTP API — auth, REST resources, webhooks, SSE for live agent runs
  web/        React dashboard (dark command-center UI)
  worker/     Background executor — runs agent tasks, automations, schedules
packages/
  config/     Zod-validated environment loading (server only)
  shared/     Types shared by web + api: roles, permissions, statuses, DTO schemas
  database/   Drizzle schema, migrations, seed + repository helpers
  agents/     Agent runtime: BaseAgent, Orchestrator, ToolRegistry, ModelProvider
  mcp/        MCP client manager, server registry, permission policy
  ui/         Shared React components (Milestone 2)
agents/       Per-agent prompts + configs (orchestrator, sales, content, …)
skills/       Business workflows used by the in-app agents (sales, content, …)
.claude/      Claude Code skills, subagents and rules for developing this repo
docs/         Architecture, plans, decisions
```

`agents/` and `skills/` (root) are **product runtime content** — prompts and
workflows the in-app agents load. `.claude/` is **developer tooling** for Claude Code
working on this repository. They are deliberately separate.

## 5. Request lifecycle

1. The operator submits a request in the dashboard → `POST /api/tasks`.
2. The API validates it, stores an `agent_tasks` row (status `QUEUED`), writes an audit log, and puts a job on the Redis queue.
3. The worker takes the job and runs the **Orchestrator**. The Orchestrator classifies the request, writes a plan (`agent_steps`) and delegates each step to a specialist agent (`agent_runs`, one per agent invocation).
4. Agents call tools through the `ToolRegistry`. The registry checks the agent's permission and the tool's risk level:
   - `read` / `draft` tools run straight away.
   - `external` / `destructive` / `financial` tools **do not run**. They create an `approvals` row and the task moves to `WAITING_APPROVAL`.
5. The operator approves, rejects or edits in the Approval Center. On approval the API claims the action (`approved → executing`) and runs it exactly once through its executor, records the outcome and writes audit logs. When none of a task's approvals is open any more, the task moves from `WAITING_APPROVAL` to `COMPLETED` with the outcomes in its result.
6. The final result is stored on the task and streamed to the UI over Server-Sent Events.

## 6. Cross-cutting concerns

- **Security**: see SECURITY_MODEL.md.
- **Agents**: see AGENT_ARCHITECTURE.md.
- **MCP**: see MCP_ARCHITECTURE.md and MCP_SERVERS.md.
- **Data**: see DATABASE_DESIGN.md.
- **Observability**: every request carries a `requestId`. Every agent run records model, latency, token usage, tool calls, errors and approval state. Logs are pino JSON and ship to stdout (collected by the host).

## 7. Deployment target (Milestone 15)

- API + worker: one container image, two process types (Railway / Render / Fly / VPS).
- Web: static build served by the API or a CDN (Vercel/Netlify).
- Postgres: managed service with pgvector (Neon, Supabase or RDS).
- Redis: managed (Upstash / Railway).
- Secrets: the host platform's secret store; never in git.
