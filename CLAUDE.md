# Aamir AI Command Center

Multi-agent AI business OS for Aamir Patni (AI educator, Pakistan). TypeScript pnpm monorepo.
Read `docs/ARCHITECTURE.md` first; the current milestone is in `docs/IMPLEMENTATION_PLAN.md`.

## Commands
- `pnpm install` · `pnpm typecheck` · `pnpm test` (needs Postgres; test DB `acc_test`)
- `pnpm db:generate` (after schema edits) · `pnpm db:migrate` · `pnpm db:create-owner`
- `pnpm dev:api` → http://localhost:4000 · `pnpm dev:worker` (agent tasks) · `pnpm dev:web` → http://localhost:5173 · local services: `docker compose up -d`
- `pnpm e2e` (Playwright; needs API + web running and `E2E_EMAIL`/`E2E_PASSWORD`)

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
- Record significant design choices in `docs/DECISIONS.md`.
- Every milestone ends with: tests green, docs updated, report COMPLETED / TESTED / ISSUES / NEXT.

## Agents
Runtime in `packages/agents` (model providers, ToolRegistry, AgentRunner, executeTask). Prompts in `agents/<id>/prompt.md`.
New tool = `Tool` with a Zod input + risk level, registered in `createDefaultToolRegistry()`, granted per agent by name.
Default model `claude-opus-5` (see docs/DECISIONS.md ADR-017); tests use `MockProvider` scripts, never the network.

## Style
ESM, strict TS, `.js` import suffixes, small modules, comments only where the reason is non-obvious.
Urdu content: natural Pakistani Urdu; keep technical terms (AI, API, MCP) in English.

## UI rules
Dark theme tokens only (no raw hex in components). Status = icon + label, never colour alone.
Never show placeholder numbers: unbuilt screens say "arrives in Milestone N", empty data shows an empty state.
