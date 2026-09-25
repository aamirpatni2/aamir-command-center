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

## 3. Authentication
- Email + password (Argon2id, 19 MiB memory, t=2, p=1).
- Sessions: 32 random bytes → base64url token in the cookie; only `sha256(token)` is stored. Idle expiry 7 days, absolute expiry 30 days. Logout and "log out all devices" revoke rows.
- Login rate limit: 5 attempts / 15 min per IP + email. Generic error message (no user enumeration). Timing kept equal with a dummy hash when the user doesn't exist.
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
