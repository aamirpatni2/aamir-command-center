# Architecture Decision Records

Each decision lists the alternatives and why the simplest production-ready option won.

## ADR-001 — TypeScript monorepo with pnpm workspaces
- **Decision**: One repo, pnpm workspaces, strict TypeScript.
- **Alternatives**: Separate repos; Turborepo/Nx; Python backend (the `sample` repo is Python).
- **Why**: Shared types between API, worker and web stop contract drift. pnpm is already installed and fast. Turborepo/Nx add tooling we don't need yet; we can add Turbo later without restructuring. The Python prototype stays a reference only.

## ADR-002 — Fastify for the API (not Next.js API routes, not Express)
- **Alternatives**: Next.js full-stack, Express, NestJS, Hono.
- **Why**: The API also hosts webhooks (WhatsApp), SSE streams and long-lived connections to the worker, so a standalone server is simpler than serverless routes. Fastify has first-party plugins for helmet, rate-limit, cookies and CORS, and it's fast. NestJS adds a lot of ceremony for a one-operator system.

## ADR-003 — React + Vite SPA for the dashboard (not Next.js)
- **Alternatives**: Next.js, Remix.
- **Why**: The dashboard sits behind a login and doesn't need SEO or SSR. A SPA served as static files is the simplest thing to deploy and keeps every secret on the API side. Next.js would duplicate the server layer.

## ADR-004 — PostgreSQL + Drizzle ORM + pgvector
- **Alternatives**: Prisma; Supabase client; separate vector DB (Pinecone, Qdrant).
- **Why**: Drizzle is TypeScript-native, produces plain SQL migrations we can review, and has no binary engine. pgvector keeps knowledge chunks next to business data in one database: one backup, one permission model, transactional updates. A dedicated vector DB can come later if volume needs it.

## ADR-005 — Server-side sessions instead of JWT
- **Alternatives**: JWT access/refresh tokens; hosted auth (Clerk, Auth0, Supabase Auth).
- **Why**: A first-party SPA on the same site should use httpOnly cookies. Server-side sessions can be revoked instantly (important if a device is lost) and are simple to audit. Only a SHA-256 hash of the session token is stored, so a database leak can't be replayed. Hosted auth adds an external dependency and cost for a single-operator system. The `users` table has `role`, so adding team members later works the same way.

## ADR-006 — Argon2id for passwords
- **Why**: Current OWASP recommendation. `@node-rs/argon2` ships prebuilt binaries (no node-gyp).

## ADR-007 — CSRF: SameSite=Strict cookie + synchronizer token header
- **Why**: SameSite=Strict blocks most cross-site requests on its own. A per-session CSRF token that must come back in the `x-csrf-token` header on every state-changing request adds defence in depth for older browsers and same-site subdomain attacks.

## ADR-008 — Model abstraction via a small `ModelProvider` interface
- **Alternatives**: LangChain, Vercel AI SDK, calling the Anthropic SDK directly everywhere.
- **Why**: We need only a few operations (generate, tool-use loop, structured output, token accounting). A thin interface we own keeps agent code provider-neutral without taking on a large framework. The Anthropic adapter comes first; OpenAI and Google adapters implement the same interface.

## ADR-009 — BullMQ on Redis for background work
- **Alternatives**: Postgres-based queue (pg-boss, graphile-worker), Temporal, Inngest.
- **Why**: Redis is available, BullMQ supports retries, delays, cron repeat jobs and concurrency limits, which covers the automation engine. Temporal is more than we need for now. pg-boss is a valid fallback if we want to drop Redis — the queue sits behind an interface.

## ADR-010 — MCP behind a ToolRegistry, never called directly by agents
- **Why**: Agents ask for a *capability* (`crm.lead.update`, `whatsapp.message.send`). The registry decides which adapter serves it (internal DB, MCP server or mock) and applies the permission and approval policy. We can swap an MCP server without touching agent code, and security has one enforcement point.

## ADR-011 — Mocks only behind interfaces, clearly labelled
- **Why**: Project rule: never fake integrations. When credentials aren't there, the adapter reports `status: "not_configured"`. Mock adapters live in `*/mock/*` files, only load when `NODE_ENV=test` or `ACC_ENABLE_MOCKS=true`, and every result they return carries `mock: true`.

## ADR-013 — Dashboard talks to the API same-origin
- **Decision**: In development Vite proxies `/api` to the API; in production the web build is served from the same site as the API (a reverse proxy or the API itself, decided in M15).
- **Why**: The session cookie stays `SameSite=Strict` and no CORS credentials are needed in normal use. The CORS allow-list stays only as a fallback.

## ADR-014 — No invented numbers in the UI
- **Decision**: Roadmap pages show an explicit "arrives in Milestone N" state. Widgets without data show empty states. Stat tiles have no delta or trend until there's real history.
- **Why**: A command center the operator makes decisions from must never show placeholder figures that look real.

## ADR-015 — Login throttling counts failures, not requests
- **Alternatives**: Plain request rate limit per IP + email (the first implementation).
- **Why**: Counting successful logins let the owner lock themselves out by signing in normally (the e2e run caught this). Only failures count now, and success resets the counter. A looser per-IP request cap stays against credential spraying.

## ADR-016 — Own the agent loop instead of the SDK tool runner
- **Alternatives**: Anthropic SDK tool runner; LangChain/agent frameworks.
- **Why**: Every step must be persisted, risky calls turned into approvals, cancellation checked between steps, and the loop has to stay provider-neutral (ADR-008). The loop is about 250 lines and fully tested with scripted mock responses.

## ADR-017 — Default model `claude-opus-5` with server-side refusal fallback
- **Decision**: `DEFAULT_MODEL=claude-opus-5`; requests send `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) so a safety-declined request is re-run on Anthropic's recommended model instead of failing; a final refusal still ends the run as `MODEL_REFUSAL`. Per-agent `model` and `effort` can override (e.g. lower effort for simple specialists).
- **Why**: Best quality for an operator-facing system; cost is controlled per agent through `effort` and visible per run (tokens + estimated cost).

## ADR-018 — No automatic job retries for agent tasks
- **Why**: A retried run could repeat side effects. Approval creation is idempotent anyway, but task re-runs are a deliberate human action.

## ADR-019 — Mock model is a labelled development tool, not a fallback
- **Decision**: The mock is used only when `ACC_ENABLE_MOCKS=true`, no real key is set, and `NODE_ENV` isn't production. Its text starts with `[MOCK]`, runs are stored with `model_provider='mock'`, and the UI shows a Mock badge everywhere.
- **Why**: The project rule forbids fake integrations. This lets the whole pipeline (queue, tools, database, approvals, logs, UI) be built and tested before the API key exists, without anything being mistaken for real output.

## ADR-020 — Orchestration: model-written plan, code-enforced execution
- **Alternatives**: a free-form orchestrator agent with a `delegate` tool it calls whenever it likes; Managed Agents multi-agent sessions.
- **Why**: A validated plan object (known agents, ≤6 steps, backwards-only dependencies) makes routing testable, visible to Aamir before the work is judged, and cheap to reason about. Deterministic execution guarantees that dependencies are respected, failures skip dependants instead of cascading silently, cancellation is honoured between steps, and specialists only see the outputs they depend on (less context, less prompt-injection surface). Steps run one at a time for now; running independent steps in parallel is a later optimisation.

## ADR-021 — Specialists declare their current limitations
- **Why**: The brief forbids fake integrations. Rather than hide agents until their tools exist, each specialist states what it can't do yet (e.g. Research has no web access until M8). The planner sees this and plans around it, the agent flags it in `blockers`/`unverifiedClaims`, and the UI shows it on the Agents page. Each limitation is removed when its milestone lands.

## ADR-022 — Deterministic, documented lead scoring
- **Alternatives**: let the model score leads.
- **Why**: Scores drive who gets called first. They must be explainable, stable and auditable. Rules live in one file with a version, every point carries its reason, and agents can only add confirmed signals (profile fit), not numbers. The v1 rules are a starter set pending Aamir's approval.

## ADR-023 — WhatsApp triage as a debounced, pre-planned task
- **Why**: Every inbound message needs a fast, cheap first look. Skipping the planner and review keeps it to one agent loop. A short delay (`WHATSAPP_TRIAGE_DELAY_SECONDS`) batches bursts of messages; if two triages still overlap, the newer reply draft supersedes the older one, so a conversation never has two pending replies. Auto-triage can be switched off with `WHATSAPP_AUTO_TRIAGE=false`.

## ADR-024 — Official WhatsApp Cloud API only
- **Why**: Unofficial WhatsApp Web automation breaks WhatsApp's terms and risks the business number being banned. The Cloud API has signed webhooks, delivery receipts and templates.

## ADR-025 — The course catalogue is the only source of prices and dates
- **Why**: Quoting the wrong fee or start date to a customer is the costliest mistake an agent can make. Prices, early-bird deadlines, dates and seats come from structured course and batch records via `course.catalog`, which hides drafts, instead of from free text. Early-bird is evaluated on the Pakistan calendar date.

## ADR-026 — Money is verified by a person
- **Why**: JazzCash, EasyPaisa and bank transfers are confirmed by checking the account, which no API does for us yet. Payments are recorded as pending by anyone with `payments:write`; only owner/admin can verify. Only verified amounts count towards balance, revenue and certificates.

## ADR-027 — Structured content formats + heuristic checks, human approval
- **Why**: Free text can't be reliably rendered (Reel beats, script chapters, carousel slides), searched or scheduled. Each type has a strict format validated on save; the body is rendered from it. Checks catch the costly mistakes (unsourced income claims, guarantees, fake scarcity, wrong language, generic AI phrasing). They warn instead of blocking because a person makes the final call, and the agent sees the checks and can fix and re-save.

## ADR-028 — Content voice from Aamir's content system, truth rules on top
- **Why**: The content playbook's hook examples include specific income figures. The system rule "never invent stats" wins: figures are only used with a source, otherwise non-numeric framing. The INCOME_CLAIM check enforces it.

## ADR-029 — Research integrity enforced in code, not only in the prompt
- **Why**: Prompts reduce invented sources but can't prevent them. `research.save` checks every cited URL against what this run actually retrieved and downgrades anything unbacked. The UI shows the downgrade note, so "verified" means verified.

## ADR-030 — Hybrid knowledge search inside Postgres; Voyage for embeddings
- **Alternatives**: a separate vector DB; embeddings only; OpenAI embeddings.
- **Why**: Full-text search works with no extra key and handles Roman Urdu/Urdu tokens; embeddings add meaning-based matches when available. Keeping both in Postgres (pgvector HNSW + GIN) means one database, and approval status is enforced in the same query. Voyage is Anthropic's recommended embedding provider; 1024 dimensions balances quality and storage.

## ADR-031 — Direct web search adapters instead of MCP servers for now
- **Why**: Two small, tested HTTP adapters behind one interface are simpler and safer than running extra MCP server processes. They fit the ToolRegistry the same way an MCP-backed tool will (M11).

## ADR-032 — Approval execution: exactly once, and "unknown" is never retried
- **Decision**: approvals move through conditional UPDATEs (`pending → approved → executing → executed`). Outcomes where nothing left the system (not configured, outside the WhatsApp window, a 4xx from Meta) go back to `approved` and can be retried. Outcomes that may have reached the provider (network error, timeout, 5xx) become `failed` and are never retried automatically.
- **Why**: the WhatsApp Cloud API has no idempotency key, so the only safe guarantee is "at most once". A duplicate message to a customer is worse than asking Aamir to check the chat.

## ADR-033 — Approved actions run in the API request, not the worker
- **Alternatives**: queue an execution job for the worker.
- **Why**: each action is a single HTTP call or DB update, and the person who pressed Approve gets the real outcome immediately ("sent" or exactly why not). The executors live in `packages/agents`, so moving them to the worker later (e.g. for bulk sends in M10) needs no rewrite.

## ADR-034 — A task waiting for approval completes when its approvals settle
- **Alternatives**: re-run the agent with the decision so it can continue.
- **Why**: re-running costs tokens and could draft new messages without a new request. Recording each approval's outcome on the task keeps the history honest; follow-up work is started deliberately (by Aamir or an automation).

## ADR-035 — Premium dark design system, self-hosted fonts, hand-built SVG charts
- **Decision**: glass surfaces over a layered ambient background; Plus Jakarta Sans (display) + Inter (UI) + JetBrains Mono, self-hosted via Fontsource (Noto Nastaliq Urdu loads only when Urdu text appears); charts are small SVG components in `@acc/ui`.
- **Alternatives**: Google Fonts CDN; Recharts / Chart.js / ECharts.
- **Why**: self-hosting keeps the strict CSP and avoids third-party requests. Our charts are simple (area, donut, bars), so ~300 lines we control give exact styling, glow and motion, accessible names and sr-only tables, and no 100 KB+ dependency. A library can be added in M12 if analytics needs zoom or brushing.

## ADR-036 — Automations as declarative rules on their own queue
- **Decision**: rules are data (trigger, AND conditions, ≤5 actions) validated by one Zod schema shared with the UI; events, schedules and a 10-minute sweep run on a separate BullMQ queue; the DB is the source of truth for schedules.
- **Alternatives**: a visual node graph / n8n-style workflow engine; running automations on the agent-task queue.
- **Why**: the automations Aamir needs are "when X, if Y, do Z". A declarative rule is easy to read, dry-run, audit and test, and can't express loops. A separate queue keeps slow agent runs from delaying event handling. A graph editor can come later on the same engine.

## ADR-037 — No auto-send from automations (yet)
- **Decision**: automation messaging always creates an Approval Center request; `policy.autoApprove` stays unused.
- **Why**: the project rule is "no external action without explicit approval". Owner-approved WhatsApp templates (M11) are the right unit for pre-approval; free-text drafts are not.

## ADR-038 — MCP servers from a committed config file with an explicit tool allow-list
- **Alternatives**: manage servers in the UI/DB; expose every tool a server offers; trust servers' readOnly annotations.
- **Why**: a stdio server is arbitrary code on the host; a config file under review is the safe place for it. Explicit per-tool risk and agent grants keep the ToolRegistry the single enforcement point (ADR-010), and a server adding new tools can't silently widen what agents can do.

## ADR-039 — Google and Canva via direct REST + OAuth, not MCP (for now)
- **Why**: both need per-user OAuth; our own small OAuth service gives encrypted storage, refresh, revoke and exact scopes, and each tool gets a precise risk level (e.g. Gmail drafts only). Their remote MCP servers can be added through mcp.config.json later without touching agents.

## ADR-040 — Templates are the only way to message outside WhatsApp's 24-hour window
- **Why**: Meta rejects free text after 24 h. Templates are pre-approved by Meta, synced locally, validated (approved status, parameter count) at send time and still approved by Aamir per message.

## ADR-041 — Analytics in SQL, narratives from the agent, numbers never from the agent
- **Decision**: every metric is a SQL aggregate over real records for Pakistan calendar days; the Analytics Agent reads them through `analytics.report` and can only add prose via `analytics.save_report`, which recomputes the numbers itself.
- **Why**: reports drive decisions. A model can misread or invent figures; saving its narrative next to server-computed metrics keeps the numbers trustworthy and the commentary useful.

## ADR-042 — "AI Insights" are rules until there's enough data for more
- **Why**: with a young database, statistical "insights" would mostly be noise. Fixed, documented rules with minimum-data thresholds (e.g. ≥ 5 answered chats, ≥ 10 leads) only speak when the data supports it; the Analytics Agent's written report adds interpretation on request.

## ADR-043 — Meta Ads read-only
- **Why**: spending money is the highest-risk action in the system. v1 uses an `ads_read` token and never writes; campaign changes would need an owner-only, approval-gated flow (not built).

## ADR-012 — Branching
- **Decision**: Work is developed on `claude/intelligent-keller-d001ud` and merged into `main` through pull requests.
