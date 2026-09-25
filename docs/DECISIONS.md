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

## ADR-012 — Branching
- **Decision**: Work is developed on `claude/intelligent-keller-d001ud` and merged into `main` through pull requests.
