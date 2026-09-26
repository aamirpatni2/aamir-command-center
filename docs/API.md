# API Reference

Base URL: `http://localhost:4000` (dev). All bodies are JSON (`content-type: application/json`; other types get 415).

## Conventions
- **Auth**: `acc_session` httpOnly cookie, set by `POST /api/auth/login`.
- **CSRF**: every `POST/PUT/PATCH/DELETE` on an authenticated route needs the header `x-csrf-token: <csrfToken>` (from the login or `/me` response).
- **Errors**: `{ "error": { "code": "VALIDATION_ERROR|UNAUTHORIZED|FORBIDDEN|CSRF_INVALID|NOT_FOUND|CONFLICT|RATE_LIMITED|INTERNAL", "message": "...", "details"?: [...] } }`
- **Tracing**: every response has `x-request-id`.
- **Rate limits**: 300 req/min per IP globally; login: 5 failed attempts / 15 min per IP + email (success resets), 30 login requests / 15 min per IP.

## Implemented (Milestones 1–12)

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/health` | public | `{status, db}`; 503 if the DB is unreachable |
| GET | `/api/health/integrations` | `mcp:read` | which integrations have credentials (booleans only) |
| POST | `/api/auth/login` | public | `{email, password}` → `{user, csrfToken, permissions}` + cookie |
| GET | `/api/auth/me` | session | current user, csrfToken, permissions |
| POST | `/api/auth/logout` | session | revoke current session → 204 |
| POST | `/api/auth/logout-all` | session | revoke all of the user's sessions → 204 |
| GET | `/api/users` | `users:read` | list users |
| POST | `/api/users` | `users:manage` | `{email, name, role, password(12+)}` → 201 |
| PATCH | `/api/users/:id` | `users:manage` | `{name?, role?, isActive?}`; can't demote or deactivate the last owner or yourself; role/active changes revoke that user's sessions |
| POST | `/api/users/:id/password` | `users:manage` | `{password(12+)}` → `{ok}`: the owner sets a temporary password for a team member (not for yourself: use `/api/auth/password`); weak-password rules; signs them out everywhere; audited `user.password_reset` |
| GET | `/api/audit-logs` | `audit:read` | `?limit&before&action&entityType` → `{auditLogs, nextBefore}` |
| GET | `/api/agents` | `tasks:read` | defined agents (description, current limitations, tools, model, effort, max steps) + model availability `{available, mock, reason?}` |
| POST | `/api/tasks` | `tasks:create` | `{input (3–4000 chars), title?}` → 202 `{task, mock}` and enqueues it. 503 `MODEL_NOT_CONFIGURED` (nothing created) or `QUEUE_UNAVAILABLE` (task marked FAILED) |
| GET | `/api/tasks` | `tasks:read` | `?status&limit` |
| GET | `/api/tasks/:id` | `tasks:read` | task (incl. `plan`, `result.issues`, `result.nextSteps`), plan `steps` with status, runs (with `stepId`/`parentRunId`), message timeline (system prompt body omitted), approvals |
| POST | `/api/tasks/:id/cancel` | `tasks:cancel` | open task → CANCELLED; 409 if already finished |
| GET | `/api/tasks/:id/events` | `tasks:read` | **SSE**: `snapshot`, `task.status`, `run.started`, `run.step`, `run.finished`; ends after a terminal status; heartbeat every 25 s |
| GET | `/api/agent-runs` | `tasks:read` | Agent Activity: agent, task, status, started, duration, tools used, tokens, cost, result/error, `mock` flag. `?agentId&status&limit` |
| GET | `/api/leads` | `leads:read` | `?q&status&band(hot/warm/cold)&due=today&sort(score/followup/recent)&limit&offset` → `{leads, total}` |
| POST | `/api/leads` | `leads:write` | `{phone, name?, email?, source?, notes?}`; phone normalised to E.164 (PK default). Existing open lead for that number → **200 `{duplicate: true}`** (merged, audited) instead of a new lead; new → 201 |
| GET | `/api/leads/:id` | `leads:read` | lead (score, band, reasons, signals), contact, conversations |
| PATCH | `/api/leads/:id` | `leads:write` | `{status?, notes?, nextFollowUpAt?, ownerUserId?, interestedCourseId?, profileFit?}`; rescored; audited. Humans may set won/lost |
| DELETE | `/api/leads/:id` | `leads:delete` | soft delete, audited |
| GET | `/api/leads/scoring` | `leads:read` | rules, bands, version |
| GET | `/api/conversations` | `leads:read` | inbox: contact, last message, band, pending draft count |
| GET | `/api/conversations/:id` | `leads:read` | messages, lead, pending reply drafts |
| POST | `/api/conversations/:id/triage` | `tasks:create` | runs the WhatsApp Agent on this conversation now → 202 `{task}` |
| GET | `/api/webhooks/whatsapp` | public | Meta subscription handshake (`hub.verify_token`) |
| POST | `/api/webhooks/whatsapp` | HMAC | `X-Hub-Signature-256` over the raw body with `WHATSAPP_APP_SECRET` (401 if wrong, 503 if not configured). Identical body replayed → `{status: "duplicate"}`; duplicate message ids ignored; failed deliveries can be retried; unknown shapes acknowledged as `ignored` |
| GET | `/api/courses` | `courses:read` | courses (incl. drafts) with batches, enrolled count, seats left, today's price |
| POST / PATCH | `/api/courses`, `/api/courses/:id` | `courses:write` | slug unique (409) |
| POST | `/api/courses/:id/batches` | `courses:write` | dates validated; early-bird needs price + date |
| PATCH / GET | `/api/batches/:id` | write / `courses:read` | GET = batch, course, roster with progress, classes, assignments |
| GET | `/api/students` | `students:read` | `?batchId&q` enrolments with progress |
| POST | `/api/enrollments` | `students:write` | `{batchId, phone, name?, email?}` creates contact/student/enrolment (pending); capacity enforced; already enrolled → 409; open lead → negotiating |
| GET | `/api/students/:id` | `students:read` | enrolments with progress, payments, certificate checks, linked lead |
| PATCH | `/api/enrollments/:id` | `students:write` | status |
| POST | `/api/enrollments/:id/payments` | `payments:write` | recorded as pending; duplicate method+reference → 409 |
| POST | `/api/payments/:id/verify` | `payments:verify` (owner/admin) | pending → verified; activates enrolment; lead → won; audited; twice → 409 |
| GET | `/api/classes` | `students:read` | `?batchId&upcoming=true` with attendance summary |
| POST / PATCH | `/api/batches/:id/classes`, `/api/classes/:id` | `students:write` | schedule, meeting link, recording |
| PUT | `/api/classes/:id/attendance` | `students:write` | `{attendance: {enrollmentId: present/late/absent}}`; rejects enrolments from other batches |
| POST | `/api/batches/:id/assignments` | `students:write` | |
| PUT | `/api/assignments/:id/submissions/:enrollmentId` | `students:write` | upsert status/score/feedback |
| POST | `/api/enrollments/:id/certificate` | `certificates:issue` (owner/admin) | 409 `NOT_ELIGIBLE` with failing checks; issued once; enrolment → completed |
| GET | `/api/content` | `content:read` | `?type=a,b&status&language&q&limit` → items with preview and check count |
| GET | `/api/content/calendar` | `content:read` | `?month=YYYY-MM` scheduled/published items in that month (Asia/Karachi) |
| GET | `/api/content/:id` | `content:read` | item with format data, checks, sources, history |
| POST | `/api/content` | `content:write` | `{type, data, language, platform?, title?}` validated per format → draft with checks |
| PATCH | `/api/content/:id` | `content:write` | edit text/title/language; re-runs checks; approved/scheduled → back to review; published → 409 |
| POST | `/api/content/:id/status` | `content:write` or `content:approve` | `{status, note?, scheduledFor?, publishedUrl?}`; transitions enforced (409 otherwise); approve/schedule/publish need `content:approve` (owner/admin); scheduling needs a future date |
| DELETE | `/api/content/:id` | `content:write` | soft delete (not published items) |
| GET | `/api/knowledge` | `knowledge:read` | `?status&category&q` documents with chunk/embedding counts + search mode |
| GET | `/api/knowledge/search` | `knowledge:read` | `?q&category` exactly what agents get from `kb.search` |
| GET / POST / PATCH | `/api/knowledge[/:id]` | read / `knowledge:write` | drafts; editing approved → back to draft + unindexed |
| POST | `/api/knowledge/:id/approve` | `knowledge:approve` | chunk + embed; falls back to full-text with a warning if embeddings fail |
| POST | `/api/knowledge/:id/archive`, `/api/knowledge/reindex` | `knowledge:approve` | |
| GET | `/api/memory` · POST `/api/memory/:id/decide` | read / `knowledge:approve` | proposed long-term memory → approved/rejected |
| GET | `/api/research`, `/api/research/:id` | `knowledge:read` | research reports with claim status counts / claims + sources |
| GET | `/api/dashboard/summary` | `analytics:read` | live counts (open tasks, new leads today, follow-ups due, active students, active agents, runs today, pending approvals), verified PKR revenue this month, 5 recent runs / pending approvals / open tasks. "Today" and "this month" use Asia/Karachi. |
| GET | `/api/approvals` | `approvals:read` | `?status=open\|decided\|all\|<status>`; each item has effective payload, original payload, `edited`, `editableFields`, context (contact, course, last customer message, 24h window), execution result, `canDecide` for the caller; `counts`. Expires stale requests first. |
| GET | `/api/approvals/:id` | `approvals:read` | same shape |
| PATCH | `/api/approvals/:id` | `approvals:decide` (+`approvals:decide_financial` for financial) | `{edits}` pending only; only the tool's `editableFields` (e.g. `text`), never target ids → 400 `INVALID_EDIT` |
| POST | `/api/approvals/:id/approve` | same | `{note?, edits?}` → approve + execute once → `{approval, outcome}`; outcome `executed` / `not_executed` (+code: `NOT_CONFIGURED`, `OUTSIDE_WINDOW`, `PRECONDITION`, `PROVIDER_REJECTED`, `NO_EXECUTOR`; nothing happened, retryable) / `unknown` (→ `failed`, never retried). 409 `ALREADY_DECIDED` / `EXPIRED` |
| POST | `/api/approvals/:id/execute` | same | retry an approved, not-executed action; 409 `NOT_EXECUTABLE` otherwise |
| POST | `/api/approvals/:id/reject` | same | `{note?}` rejects a pending request or cancels an approved, not-executed one |
| GET | `/api/automations` | `automations:read` | rules (definition, trigger summary, run counts, last status, next 3 schedule runs) + `canManage` + catalogue (events, fields, operators, actions, agents, templates) |
| GET | `/api/automations/runs` | `automations:read` | `?ruleId&limit` run history with per-action results (task / approval ids) |
| POST | `/api/automations` · PUT `/api/automations/:id` | `automations:manage` (owner) | full rule definition; 400 for unknown fields, actions the trigger can't support, `won/lost` status, invalid cron or more often than every 15 min |
| POST | `/api/automations/:id/enabled` | owner | `{enabled}`; registers/removes the schedule (warning, not error, if Redis is down) |
| POST | `/api/automations/:id/run` | owner | schedule rules only: run once now (works while switched off) |
| POST | `/api/automations/dry-run` | owner | definition → sample record, condition results, rendered actions, next runs. No writes |
| DELETE | `/api/automations/:id` | owner | soft delete + remove schedule |
| GET | `/api/integrations` | `mcp:read` (owner/admin) | core services (state + which env vars are set, never values), OAuth providers (connection, account, scopes, redirect URL, setup steps), MCP servers (state, error, tools with risk/agents/availability), synced WhatsApp templates |
| POST | `/api/integrations/:provider/connect` | `mcp:manage` (owner) | `google`/`canva` → `{url}` to the provider; 400 `NOT_CONFIGURED` naming the missing variables |
| GET | `/api/integrations/oauth/callback` | none (single-use state) | provider redirect; exchanges the code, stores encrypted tokens, 302 to `/mcp?connected=…` or `?error=…` |
| POST | `/api/integrations/:provider/test` · `/disconnect` | owner | live check (refreshes if needed) / revoke + forget; `whatsapp` test checks the phone number ID |
| POST | `/api/integrations/mcp/:id/test` | owner | reconnect a configured MCP server and report its state |
| POST | `/api/whatsapp/templates/sync` | `mcp:read` | mirror templates from WhatsApp Manager |
| GET | `/api/analytics` | `analytics:read` | `?preset=last_7_days\|last_30_days\|…` or `?from&to` (YYYY-MM-DD, Pakistan days, ≤ 1 year) → `{current, previous}` |
| GET | `/api/analytics/today` | `analytics:read` | what needs a person now |
| GET | `/api/analytics/insights` | `analytics:read` | rule-based insights for the range |
| GET | `/api/reports` · `/api/reports/:id` | `analytics:read` | saved reports |
| POST | `/api/reports` | `tasks:create` | `{period, preset \| from+to}` numbers-only snapshot |
| POST | `/api/reports/agent` | `tasks:create` | `{preset, period}` queues the Analytics Agent to write and save the report |
| GET | `/api/ads` | `campaigns:read` | `?preset=last_7d\|last_30d\|last_90d` Meta campaign results (read-only) or `not_configured` |

## Planned

| Resource | Milestone |
|---|---|
