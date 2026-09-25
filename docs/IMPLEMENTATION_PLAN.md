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
| 6 | Student Agent + Courses | courses/batches/students/enrollments/classes/assignments/payments API + UI | enrollment + certificate rules tests | ⏭ next |
| 7 | Content Agent | content items, Urdu/English generation, calendar view, Reels/scripts/prompts | output schema tests, language rules | |
| 8 | Research Agent | web research MCP, source-backed findings, verification pass, KB ingestion + embeddings | unverified-claim test | |
| 9 | Approval Center | pending/approve/reject/edit UI, idempotent execution, audit | approval + unauthorized-approval tests | |
| 10 | Automation Engine | trigger → condition → agent → tool → approval → action → log; cron rules (morning research) | workflow tests | |
| 11 | MCP integrations | McpClientManager, WhatsApp send, Google, Canva, filesystem | failed MCP server test | |
| 12 | Analytics | read-only views, dashboards, daily/weekly reports, agent performance | numbers match fixtures | |
| 13 | Security hardening | encryption of stored tokens, audit immutability role, dependency audit, headers review, pen-test checklist | security test suite | |
| 14 | Testing | coverage gaps, e2e (Playwright) for core flows | CI green | |
| 15 | Deployment | Dockerfile, compose, CI (GitHub Actions), deploy guide, backups | staging deployed | |

## Dependencies (by milestone)
- **M1**: fastify, @fastify/{cookie,helmet,rate-limit,cors,sensible}, zod, drizzle-orm, postgres (postgres.js), drizzle-kit, @node-rs/argon2, pino, dotenv, vitest, tsx, typescript.
- **M2**: react, react-dom, react-router, vite, @vitejs/plugin-react, tailwindcss, @tanstack/react-query, lucide-react.
- **M3**: @anthropic-ai/sdk, bullmq, ioredis.
- **M8**: embedding provider (decision at M8), @modelcontextprotocol/sdk.
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
