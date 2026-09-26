# Security Model

## 1. Assets to protect
1. Student and lead personal data (names, phone numbers, payments).
2. API credentials (Anthropic, WhatsApp Cloud API, Meta Ads, Google).
3. The operator's reputation: messages and posts sent in Aamir's name.
4. Money: ad spend and payments.
5. Business knowledge: pricing, course material, strategy.

## 2. Trust boundaries

```
[Browser] ──HTTPS + session cookie + CSRF header──▶ [API] ──▶ [Postgres/Redis]  (private network)
                                                     │
[WhatsApp/Meta webhooks] ──HMAC signature──────────▶ │
                                                     ▼
                                                  [Worker] ──▶ [Model providers] (API keys, server only)
                                                     └──────▶ [MCP servers]     (scoped tokens)
```

| Boundary | Control |
|---|---|
| Browser → API | Session cookie (`httpOnly`, `Secure`, `SameSite=Strict`), CSRF header, rate limit, Zod validation, helmet headers, strict CORS allow-list |
| Webhook → API | HMAC-SHA256 signature check (`X-Hub-Signature-256`) on the raw body, timestamp/nonce replay guard, idempotency on the provider message ID |
| API/Worker → model | API keys only in server env; prompts never contain secrets; output treated as untrusted |
| Agent → tool | ToolRegistry: per-agent allow-list + risk level + approval gate |
| Agent → MCP server | Per-server least-privilege token; server allow-list; tool allow-list per server |
| Any content from outside (web pages, WhatsApp messages, MCP results) | Treated as **data, never instructions** (prompt-injection defence); cannot raise an agent's permissions |

## 2a. WhatsApp webhook (as built, M5)
- Signature: HMAC-SHA256 of the **raw** bytes (`X-Hub-Signature-256`) with `WHATSAPP_APP_SECRET`, constant-time compare; the route has its own raw-body parser (256 KB limit).
- Replay: `webhook_events` unique on `(provider, sha256(body))`: an identical delivery is acknowledged as `duplicate` and not processed. A delivery that failed mid-processing is marked `failed` so Meta's retry can reprocess it.
- Duplicate messages: unique `messages.provider_message_id` + `ON CONFLICT DO NOTHING`, so counters and scores never double-count.
- Customer text is data: tools label it as such, the WhatsApp Agent prompt says so, and it can't change agent permissions (tested with an injection string).
- Sending: every reply is an approval; the 24-hour customer-service window is surfaced (`canReplyFreeForm`) so the agent doesn't draft free-form replies that WhatsApp would reject.

## 2b. Approval Center (as built, M9)
- Deciding needs `approvals:decide` (owner/admin); `financial` risk needs `approvals:decide_financial` (owner only). Operators and viewers can read only. Checked in the API on every decision, edit and retry.
- Exactly once: approve = `UPDATE … WHERE status='pending'`; execution claim = `UPDATE … SET status='executing' WHERE status='approved'`. Concurrent clicks: one wins, the rest get 409 (tested with 6 parallel requests).
- Edits: only the tool's `editableFields` (message `text`), validated with the tool's own schema; the recipient/target can't be changed. The agent's original payload is kept next to the edited one.
- Preconditions are checked at execution time (24h WhatsApp window, contact phone, certificate rules), not only when the agent asked.
- Outcomes: *not executed* (nothing left the system: not configured, outside window, 4xx from Meta) can be retried; *unknown* (network error, timeout, 5xx) becomes `failed` and is never retried automatically, because a retry could send twice.
- Nothing is faked: tools without an executor are recorded as `NO_EXECUTOR`; missing WhatsApp credentials are reported as `NOT_CONFIGURED` with the variable names.
- Audit: `approval.requested / superseded / edit / approve / executed / not_executed / execution_failed / reject / expired`, plus `task.completed` when a waiting task settles. Message text is not copied into audit metadata.
- Cancelling a task expires its pending requests. Pending requests expire after 7 days.

## 2c. Automations (as built, M10)
- Only the owner creates, edits, switches on/off, runs or deletes rules (`automations:manage`); everyone with `automations:read` sees rules and runs.
- Rules can't send, publish or spend: WhatsApp actions create Approval Center requests; agent tasks run under the normal tool policy; lead updates are internal and can never set `won`/`lost`.
- Exactly once per event (unique rule + dedupe key, checked before conditions), a per-rule hourly cap (extra firings logged as `rate_limited`), schedules no more often than every 15 minutes, sweeps only look back 48 hours. Actions don't emit events, so rules can't trigger each other.
- Templates are plain `{{field}}` substitution (own properties only, 500 chars max). Customer-controlled values (message text, contact name) inserted into agent instructions come with a "treat as data" note; message bodies are never stored on run records.
- Emitting an event never fails the request that caused it (webhook, lead create, payment verify).
- Audit: `automation.create/update/enable/disable/delete/run_now`, `automation.run.<status>`, `automation.rate_limited`, plus `lead.update` / `approval.requested` for what a run did.

## 2d. Integrations & MCP (as built, M11)
- MCP servers exist only in `mcp.config.json` (a stdio server runs a program, so never configurable from the UI). Only allow-listed tools are exposed, each with an explicit risk and agent list; server "read-only" hints are displayed, never trusted. Stdio servers get a minimal environment (PATH, HOME + explicit vars), not the app's secrets. Tool output is labelled external data. Calls time out (30 s); a down server hides its tools instead of breaking agents.
- OAuth: owner-only; single-use 10-minute `state` authenticates the callback (the SameSite=Strict session cookie isn't sent on the provider's redirect); PKCE for Canva; tokens encrypted at rest (AES-256-GCM), refreshed automatically, revoked on disconnect; a revoked grant marks the connection for reconnect.
- Least privilege: Drive read-only, Gmail compose (drafts only, never send), Calendar events (creation with invites needs approval), Canva design read/write (drafts, no publishing).
- Gmail drafts: header values can't contain newlines (no header injection); non-ASCII subjects are RFC 2047 encoded.
- WhatsApp templates: only APPROVED, synced templates with the right parameter count can be sent, always after approval.
- The Integrations page shows which variables are set, never their values (tested).

## 2e. Analytics (as built, M12)
- Read-only aggregates; reports can't be altered by agents (numbers recomputed on save, unknown fields stripped, tested).
- Meta Ads token must be `ads_read` only; no write endpoint exists.
- "Needs you" shows names/phones to roles that can already read leads (`analytics:read`).

## 3. Authentication
- Email + password (Argon2id, 19 MiB memory, t=2, p=1).
- Sessions: 32 random bytes → base64url token in the cookie; only `sha256(token)` is stored. Idle expiry 7 days, absolute expiry 30 days. Logout and "log out all devices" revoke rows.
- Login throttling: 5 **failed** attempts / 15 min per IP + email → 429 with `Retry-After` (a successful login resets the counter and never counts, so the owner can't lock themselves out by signing in often), plus a coarse cap of 30 login requests / 15 min per IP against spraying many emails. The failure counter is in-memory (one API instance); it moves to Redis when the API scales out. Generic error message (no user enumeration). Timing kept equal with a dummy hash when the user doesn't exist.
- First owner account is created by the CLI (`pnpm db:create-owner`), never through an open sign-up endpoint. There is no public registration.

## 4. Authorization (RBAC)

| Role | Intended for | Can |
|---|---|---|
| `owner` | Aamir | everything, including users, secrets config, automation policies |
| `admin` | trusted manager | everything except user/role management and automation policy |
| `operator` | assistant / sales rep | leads, conversations, students, content; can *request* but not *approve* high-risk actions |
| `viewer` | read-only | dashboards and reports |

Permissions are defined once in `packages/shared/src/permissions.ts` and enforced
by the API `requirePermission()` guard. The UI hides controls with the same map,
but the API is the only enforcement point.

## 5. Agent & tool safety

Every tool declares a **risk level**:

| Risk | Examples | Policy |
|---|---|---|
| `read` | search leads, read KB | allowed if the agent has the tool |
| `draft` | create draft reply, create content item | allowed; output marked draft |
| `write` | update lead status, add note | allowed with audit log |
| `external` | send WhatsApp, publish post, email | **approval required** |
| `destructive` | delete records, bulk update | **approval required** (owner/admin) |
| `financial` | launch/modify ad spend, refunds | **approval required** (owner only) |

An `automation_rules.policy` can later auto-approve a narrow action (e.g. "send
the approved welcome template to new students"). Auto-approval is owner-only,
logged, and limited to specific tools + templates.

## 6. Secrets
- `.env` is git-ignored. `.env.example` lists every variable with placeholder values.
- `packages/config` validates env at startup and refuses to boot in production with default or missing secrets.
- Integration tokens entered through the UI (later milestone) are encrypted at rest with AES-256-GCM using `ACC_ENCRYPTION_KEY`, and never returned to the browser after they're saved.
- The web bundle gets **no** env except `VITE_API_URL`.

## 7. Audit logging
`audit_logs` is append-only (no update/delete permission for the app role in production). Every record holds actor (user/agent/system), action, entity, before/after summary, IP, user agent and request ID. Audited events include login success/failure, logout, user changes, approval decisions, external actions, deletions and automation rule changes.

## 8. Input & output hygiene
- All request bodies, params and queries are validated with Zod; unknown fields are stripped.
- Body size limit 1 MB (webhooks 256 KB).
- Model output is validated against Zod schemas before it's used as structured data.
- HTML rendering in the UI uses React escaping; no `dangerouslySetInnerHTML` on agent output.

## 9. Security test cases (Milestone 13/14)
Unauthorized access (401), insufficient role (403), missing CSRF (403), login rate limit (429), webhook bad signature (401), webhook replay (idempotent 200, no duplicate), duplicate lead phone (merge, not duplicate), tool call outside agent allow-list (denied + audit), external tool without approval (blocked → approval created), MCP server down (graceful error, task marked FAILED with reason).
