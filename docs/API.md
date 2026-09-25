# API Reference

Base URL: `http://localhost:4000` (dev). All bodies are JSON (`content-type: application/json`; other types get 415).

## Conventions
- **Auth**: `acc_session` httpOnly cookie, set by `POST /api/auth/login`.
- **CSRF**: every `POST/PUT/PATCH/DELETE` on an authenticated route needs the header `x-csrf-token: <csrfToken>` (from the login or `/me` response).
- **Errors**: `{ "error": { "code": "VALIDATION_ERROR|UNAUTHORIZED|FORBIDDEN|CSRF_INVALID|NOT_FOUND|CONFLICT|RATE_LIMITED|INTERNAL", "message": "...", "details"?: [...] } }`
- **Tracing**: every response has `x-request-id`.
- **Rate limits**: 300 req/min per IP globally; login: 5 failed attempts / 15 min per IP + email (success resets), 30 login requests / 15 min per IP.

## Implemented (Milestones 1–3)

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
| GET | `/api/audit-logs` | `audit:read` | `?limit&before&action&entityType` → `{auditLogs, nextBefore}` |
| GET | `/api/agents` | `tasks:read` | defined agents (description, current limitations, tools, model, effort, max steps) + model availability `{available, mock, reason?}` |
| POST | `/api/tasks` | `tasks:create` | `{input (3–4000 chars), title?}` → 202 `{task, mock}` and enqueues it. 503 `MODEL_NOT_CONFIGURED` (nothing created) or `QUEUE_UNAVAILABLE` (task marked FAILED) |
| GET | `/api/tasks` | `tasks:read` | `?status&limit` |
| GET | `/api/tasks/:id` | `tasks:read` | task (incl. `plan`, `result.issues`, `result.nextSteps`), plan `steps` with status, runs (with `stepId`/`parentRunId`), message timeline (system prompt body omitted), approvals |
| POST | `/api/tasks/:id/cancel` | `tasks:cancel` | open task → CANCELLED; 409 if already finished |
| GET | `/api/tasks/:id/events` | `tasks:read` | **SSE**: `snapshot`, `task.status`, `run.started`, `run.step`, `run.finished`; ends after a terminal status; heartbeat every 25 s |
| GET | `/api/agent-runs` | `tasks:read` | Agent Activity: agent, task, status, started, duration, tools used, tokens, cost, result/error, `mock` flag. `?agentId&status&limit` |
| GET | `/api/dashboard/summary` | `analytics:read` | live counts (open tasks, new leads today, follow-ups due, active students, active agents, runs today, pending approvals), verified PKR revenue this month, 5 recent runs / pending approvals / open tasks. "Today" and "this month" use Asia/Karachi. |

## Planned

| Resource | Milestone |
|---|---|
| `/api/leads`, `/api/conversations`, `/api/webhooks/whatsapp` | 5 |
| `/api/students`, `/api/courses` | 6 |
| `/api/content` | 7 |
| `/api/research`, `/api/knowledge` | 8 |
| `/api/approvals` | 9 |
| `/api/automations` | 10 |
| `/api/mcp` | 11 |
| `/api/analytics` | 12 |
