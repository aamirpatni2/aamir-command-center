# Aamir AI Command Center

Multi-agent AI business OS for Aamir Patni (AI educator, Pakistan). TypeScript pnpm monorepo.
Read `docs/ARCHITECTURE.md` first; the current milestone is in `docs/IMPLEMENTATION_PLAN.md`.

## Commands
- Cloud sessions: `.claude/hooks/session-start.sh` runs automatically (deps, Postgres+pgvector, Redis, dev `.env`, migrations).
- `pnpm install` · `pnpm typecheck` · `pnpm test` (needs Postgres; test DB `acc_test`)
- `pnpm db:generate` (after schema edits) · `pnpm db:migrate` · `pnpm db:create-owner`
- `pnpm dev:api` → http://localhost:4000 · `pnpm dev:worker` (agent tasks) · `pnpm dev:web` → http://localhost:5173 · local services: `docker compose up -d`
- `pnpm e2e` (Playwright; needs API + web running and `E2E_EMAIL`/`E2E_PASSWORD`). Specs must create their own data. Tag specs that need an AI model `{ tag: "@model" }` (production has no mock model; the CI `stack` job runs `--grep-invert @model`).
- Production: `docker build .` · `deploy/` (compose, Caddy, backups) · docs/DEPLOYMENT.md

## Layout
`apps/api` Fastify API · `apps/web` React dashboard · `apps/worker` jobs ·
`packages/{config,shared,database,agents,mcp,ui}` (ui = shared React components; theme tokens in `apps/web/src/index.css`) · `agents/` + `skills/` = runtime agent prompts/workflows ·
`.claude/` = tooling for developing this repo.

## Non-negotiable rules
- Never fake an integration. Missing credentials → adapter returns `not_configured`; mocks only in `*/mock/*`, test/dev only, results carry `mock: true`.
- Tools with risk `external | destructive | financial` must go through the Approval Center. Never add a bypass.
- Never hard-code or log secrets; add new env vars to `.env.example` and `packages/config`.
- Validate every input with Zod; enforce permissions with `requireAuth("<permission>")` (see `packages/shared/src/roles.ts`).
- Write an audit log (`writeAudit`) for auth, user, approval, external and destructive actions.
- Schema changes: edit `packages/database/src/schema/*`, run `pnpm db:generate`, commit the SQL. Never edit applied migrations.
- Correlated SQL sub-queries: write the outer column fully qualified (`"table"."col"`), never `${schema.table.col}` — drizzle renders it bare (`"id"`) in single-table selects, which silently binds to the inner table.
- The app runs as a least-privilege DB role in production: runtime code must never need DDL, TRUNCATE, or UPDATE/DELETE on `audit_logs`.
- The dashboard runs under a strict CSP: no inline scripts, `eval`/`new Function`, third-party script/style/font URLs, or `<style>` injection. `@acc/shared/zod-csp` must stay the first import in `apps/web/src/main.tsx`.
- Throttles use `WindowStore` (Redis in production), never in-process maps.
- Record significant design choices in `docs/DECISIONS.md`.
- Every milestone ends with: tests green, docs updated, report COMPLETED / TESTED / ISSUES / NEXT.

## Agents
Runtime in `packages/agents` (model providers, ToolRegistry, AgentRunner, executeTask). Prompts in `agents/<id>/prompt.md`.
New tool = `Tool` with a Zod input + risk level, registered in `createDefaultToolRegistry()`, granted per agent by name.
Integrations: MCP servers only in `mcp.config.json` (allow-listed tools, explicit risk + agents; `packages/agents/src/mcp`); OAuth in `integrations/oauth/service.ts` (tokens encrypted); Google/Canva tools in `tools/workspace.ts`; WhatsApp templates in `integrations/whatsapp/templates.ts`.
Automations: rule schema + pure helpers in `packages/shared/src/automations.ts`; engine in `packages/agents/src/automations/engine.ts`; emit events with `emitEvent` (never let it fail a request); BullMQ job ids must not contain ":".
Approval-gated tools (`external/destructive/financial`) also need an executor in `packages/agents/src/approvals/executors.ts` (else approvals end as `NO_EXECUTOR`) and `editableFields` if a person may reword them. Never retry an execution whose outcome is unknown.
Content formats + checks in `packages/shared/src/content.ts` (+ `skills/content/FORMATS.md`); saving in `packages/database/src/content.ts`.
Education logic in `packages/database/src/education.ts`; fee/certificate rules in `packages/shared/src/education.ts` (+ `skills/student/POLICIES.md`).
CRM logic in `packages/database/src/crm.ts`; scoring rules in `packages/shared/src/lead-scoring.ts` (+ `skills/sales/SCORING.md`).
WhatsApp: webhook `apps/api/src/routes/webhooks.ts`, client/payloads `packages/agents/src/integrations/whatsapp`; `pnpm whatsapp:simulate` for local tests.
Orchestration (plan → delegate → review) in `packages/agents/src/orchestration`; `pnpm eval:routing` measures real-model routing (costs API credits).
Default model `claude-opus-5` (see docs/DECISIONS.md ADR-017); tests use `MockProvider` scripts, never the network.

## Style
ESM, strict TS, `.js` import suffixes, small modules, comments only where the reason is non-obvious.
Urdu content: natural Pakistani Urdu; keep technical terms (AI, API, MCP) in English.

Security: every route needs `requireAuth(permission)` as its preHandler (the route sweep test fails otherwise; public routes are listed in `route-security.test.ts`). Endpoints that start agent runs add `app.agentRuns.guard`. Run `pnpm security` before pushing.

## UI rules
Dark theme tokens only (no raw hex in components). Status = icon + label, never colour alone.
Never show placeholder numbers: unbuilt screens say "arrives in Milestone N", empty data shows an empty state.
Design system (docs/DESIGN_SYSTEM.md): tokens in `apps/web/src/index.css`; surfaces use the `glass` utility (Card/StatTile);
`brand` gradient only for primary actions; `viz-*` tones only for charts and identity chips (`AgentChip`, `lib/agents.ts`).
Charts = `@acc/ui` AreaChart/DonutChart/BarList/Meter (SVG, real data only, legend + sr-only table). Motion must respect reduced-motion.
`cn()` uses tailwind-merge, so a `className` override always wins.
