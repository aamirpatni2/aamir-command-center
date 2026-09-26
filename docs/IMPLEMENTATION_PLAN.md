# Implementation Plan & Roadmap

Each milestone runs: implement → test → inspect errors → fix → re-test → update docs → report (COMPLETED / TESTED / ISSUES / NEXT).

| # | Milestone | Deliverables | Exit criteria | Status |
|---|---|---|---|---|
| 0 | Environment audit + architecture | docs/*, repo skeleton, CLAUDE.md, .claude skills/agents | docs reviewed | ✅ done |
| 1 | Repository + database + authentication | pnpm monorepo, config package, full DB schema + migration, Fastify API with sessions, RBAC, CSRF, rate limit, helmet, audit log, owner bootstrap, tests | `pnpm typecheck && pnpm test` green against real Postgres | ✅ done |
| 2 | Dashboard shell | Vite/React/Tailwind dark UI, login page, sidebar nav (TODAY/EDUCATION/CONTENT/INTELLIGENCE/SYSTEM), dashboard widgets using live API counts | login → dashboard works in browser; screenshot | ✅ done |
| 3 | Agent runtime | `ModelProvider` (Anthropic + Mock), `ToolRegistry` with risk policy, `AgentRunner` loop, run/step/message persistence, BullMQ worker, SSE run stream | agent test with MockProvider; real Claude smoke test when key present | ✅ done (real-Claude smoke test pending the API key) |
| 4 | Orchestrator | classify → plan → delegate → verify → summarise with `agent_steps`; first specialist agents; plan view in task detail | routing guard-rail tests + real-model routing eval (`pnpm eval:routing`, needs the key) | ✅ done (eval pending the API key) |
| 5 | Sales Agent + Leads | leads/contacts API + UI, documented scoring rules, duplicate handling, WhatsApp webhook (signature, replay) + WhatsApp Agent drafting | duplicate lead/message + webhook replay tests | ✅ done |
| 6 | Student Agent + Courses | courses/batches/students/enrollments/classes/assignments/payments API + UI | enrollment + certificate rules tests | ✅ done |
| 7 | Content Agent | content items, Urdu/English generation, calendar view, Reels/scripts/prompts | output schema tests, language rules | ✅ done |
| 8 | Research Agent | web research MCP, source-backed findings, verification pass, KB ingestion + embeddings | unverified-claim test | ✅ done (live web + semantic search pending keys) |
| 9 | Approval Center | pending/approve/reject/edit UI, idempotent execution, audit | approval + unauthorized-approval tests | ✅ done (live sending pending WhatsApp credentials) |
| 10 | Automation Engine | trigger → condition → agent → tool → approval → action → log; cron rules (morning research) | workflow tests | ✅ done |
| 11 | MCP integrations | McpClientManager, WhatsApp send, Google, Canva, filesystem | failed MCP server test | ✅ done (Google/Canva/WhatsApp sending pending credentials) |
| 12 | Analytics | read-only views, dashboards, daily/weekly reports, agent performance | numbers match fixtures | ✅ done (ads pending META_ADS credentials) |
| 13 | Security hardening | encryption of stored tokens, audit immutability role, dependency audit, headers review, pen-test checklist | security test suite | ✅ done |
| 14 | Testing | coverage gaps, e2e (Playwright) for core flows | CI green | ✅ done |
| 15 | Deployment | Dockerfile, compose, CI (GitHub Actions), deploy guide, backups | staging deployed | ⏭ next |

## Dependencies (by milestone)
- **M1**: fastify, @fastify/{cookie,helmet,rate-limit,cors,sensible}, zod, drizzle-orm, postgres (postgres.js), drizzle-kit, @node-rs/argon2, pino, dotenv, vitest, tsx, typescript.
- **M2**: react, react-dom, react-router, vite, @vitejs/plugin-react, tailwindcss, @tanstack/react-query, lucide-react.
- **M3**: @anthropic-ai/sdk, bullmq, ioredis.
- **M8**: embedding provider (decision at M8), @modelcontextprotocol/sdk.
- **M13 (as built)**: dependency audit clean (override for a dev-only esbuild advisory); audit log append-only via DB trigger; automatic route sweep (auth / CSRF / viewer-can't-mutate on every endpoint) which found and fixed one ordering bug; `Cache-Control: no-store` + Permissions-Policy on API responses; per-user agent-run budget shared across endpoints; self-service password change (weak-password rules, other sessions revoked); production config refuses http URLs and reused secrets; secret scanner (`pnpm security:secrets`); pen-test checklist (docs/SECURITY_CHECKLIST.md).
- **M14 (as built)**: coverage reporting (`pnpm test:coverage`, v8; lines 90.5%, statements 86.5%, branches 71.6%); worker job handlers split into `apps/worker/src/jobs.ts` and tested (fixed: a crashed triage run left its task RUNNING); real-Redis queue tests; tool tests for education, workspace (fake OAuth fetch), analytics and templates; "Needs you" branch tests; student search accepts local phone format (0345…); a timing-dependent webhook test fixed; e2e roles-and-permissions flow; GitHub Actions CI (`.github/workflows/ci.yml`): typecheck, secret scan + dependency audit, unit tests on Postgres/pgvector + Redis, and the full Playwright suite against running API/worker/web with mocks.
- **M12 (as built)**: `getAnalytics` (revenue verified-only, funnel by current status, WhatsApp reply time per customer turn, attendance, content, agents, approvals, automations, ads) over Pakistan calendar days with previous-period comparison; "Needs you" view (unanswered chats, quiet hot leads, follow-ups, payments to verify, approvals, classes); rule-based insights with minimum-data thresholds; reports (server-computed snapshots + Analytics Agent narrative via `analytics.save_report`, which can't supply numbers); weekly report automation template; read-only Meta Ads adapter + `ads.insights`. Pages: Needs you, Analytics, AI Insights, Reports, Ads. Every nav section is now live.
- **M11 (as built)**: `McpClientManager` (stdio + streamable HTTP, @modelcontextprotocol/sdk) driven by `mcp.config.json`; allow-listed tools become `mcp.<server>.<tool>` registry tools with explicit risk + agent grants, hidden while their server is down; risky MCP tools go through approvals. Official filesystem MCP server connected for `data/uploads` (read-only tools). OAuth service (Google, Canva/PKCE) with single-use state, AES-256-GCM token storage, refresh and revoke. Tools: Calendar list/create (approval), Drive search, Gmail drafts (never send), Canva list/create. WhatsApp templates: sync, `whatsapp.templates`, `whatsapp.send_template` (approval; works outside 24 h), automation action. Integrations page.
- **M10 (as built)**: rules = trigger (WhatsApp message, new lead, payment verified, no reply for X h, no activity for X days, schedule) → AND conditions → up to 5 actions (agent task, lead update, WhatsApp draft → Approval Center). Separate BullMQ `automations` queue; schedules are BullMQ job schedulers in Asia/Karachi re-synced from the DB on worker start; 10-minute sweep for time-based triggers (48 h look-back). Exactly-once per event (unique rule + dedupe key), per-rule hourly cap, dry run, run now, run history, 5 starter templates (created off). Owner-only management. Auto-approval of messages is deliberately NOT implemented yet (needs templates, M11).
- **M9 (as built)**: approval state machine with exactly-once execution (conditional updates, `executing` claim), executors for `whatsapp.send`, `student.message` (24h window enforced at send time) and `certificate.request` (same rules as the manual route); edit (text only), reject/cancel, retry for not-executed actions, unknown outcomes never auto-retried; waiting tasks complete when their approvals settle; task cancel expires its requests; Approval Center page + approve/reject inline in Conversations. Execution runs in the API request (one HTTP call, immediate feedback) rather than the worker.
- **M8 (as built)**: Brave/Tavily web search + SSRF-safe fetch; research integrity enforced in code (verified only with sources retrieved in-run); knowledge approval → chunking → hybrid search (Postgres FTS always, Voyage embeddings when configured); proposed-memory approval; SessionStart hook for cloud sessions. Fixed a correlated sub-query bug (catalogue seats, knowledge counts).
- **M7 (as built)**: 9 validated content formats, automatic checks (language, AI-isms, Hindi words, income/guarantee/scarcity claims, unsourced stats), review workflow and calendar; publishing is recorded manually until integrations (M11). E2E suite now signs in once (login rate limits apply to tests too).
- **M6 (as built)**: certificate + fee rules are a STARTER set (`skills/student/POLICIES.md`); `course.catalog` is the only source agents use for prices/dates; payment verification is human-only (owner/admin).
- **M5 (as built)**: scoring rules are a STARTER set pending Aamir's approval (`skills/sales/SCORING.md`); WhatsApp receive path is live via webhook, sending approved replies lands with M9; `pnpm whatsapp:simulate` for local testing.
- **M4 (as built)**: all 8 specialists defined with honest `limitations` until their data/tools arrive; plan → sequential delegation → review; routing eval script.
- **M3 (as built)**: Tasks API + Tasks/Task detail/Agents screens pulled forward from M4 so the runtime is usable end-to-end; BullMQ pinned to v5 with ioredis 5.
- **M2 (added)**: @playwright/test for the e2e smoke test (pulled forward from M14).

## Credentials needed (by milestone) — the build stops at these boundaries
| Milestone | Variable | Where to get it |
|---|---|---|
| 3 | `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| 5 | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Meta for Developers → WhatsApp Cloud API app + Business Manager system user |
| 8 | `BRAVE_API_KEY` or `TAVILY_API_KEY`; embeddings key | provider dashboards |
| 11 | Google OAuth client, Canva Connect app | Google Cloud Console, Canva Developers |
| 12 | `META_ADS_ACCESS_TOKEN` (ads_read), `META_AD_ACCOUNT_ID` | Business Manager |

## Claude Code tooling for developing this repo
- **Skills** (`.claude/skills/`): sales-workflow, content-workflow, research-workflow, student-workflow, marketing-workflow, analytics-workflow, mcp-integration, security-review, testing, deployment.
- **Subagents** (`.claude/agents/`): sales-agent, content-agent, research-agent, student-agent, marketing-agent, analytics-agent, security-reviewer, qa-agent.
