# API Reference

Base URL: `http://localhost:4000` (dev). All bodies are JSON (`content-type: application/json`; other types get 415).

## Conventions
- **Auth**: `acc_session` httpOnly cookie, set by `POST /api/auth/login`.
- **CSRF**: every `POST/PUT/PATCH/DELETE` on an authenticated route needs the header `x-csrf-token: <csrfToken>` (from the login or `/me` response).
- **Errors**: `{ "error": { "code": "VALIDATION_ERROR|UNAUTHORIZED|FORBIDDEN|CSRF_INVALID|NOT_FOUND|CONFLICT|RATE_LIMITED|INTERNAL", "message": "...", "details"?: [...] } }`
- **Tracing**: every response has `x-request-id`.
- **Rate limits**: 300 req/min per IP globally; login 5 attempts / 15 min per IP + email.

## Implemented (Milestone 1)

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

## Planned

| Resource | Milestone |
|---|---|
| `/api/agents`, `/api/tasks` (+ SSE `/api/tasks/:id/stream`) | 3–4 |
| `/api/leads`, `/api/conversations`, `/api/webhooks/whatsapp` | 5 |
| `/api/students`, `/api/courses` | 6 |
| `/api/content` | 7 |
| `/api/research`, `/api/knowledge` | 8 |
| `/api/approvals` | 9 |
| `/api/automations` | 10 |
| `/api/mcp` | 11 |
| `/api/analytics` | 12 |
