# Security Checklist (pen-test style)

Status after Milestone 13. ✅ = implemented and covered by an automated test · 🟡 = implemented, verify on the
production host · ⏭ = planned (milestone) · 👤 = needs an owner decision/action.

Run locally: `pnpm security` (secret scan + dependency audit), `pnpm test` (includes the route sweep).

## Authentication & sessions
| Item | Status | Where |
|---|---|---|
| Argon2id password hashing; dummy hash for unknown emails (no user enumeration by timing) | ✅ | `auth.ts`, `auth.test.ts` |
| Login throttled per IP+email on failures; coarse per-IP cap | ✅ | `security.test.ts` |
| Password policy: 12+ chars, not common, not the email, not the previous one | ✅ | `route-security.test.ts` |
| Change password requires the current one and signs out all other sessions | ✅ | `route-security.test.ts` |
| Sessions: random 256-bit token, only an HMAC hash stored, httpOnly + SameSite=Strict (+ Secure in production), idle + absolute expiry | ✅ | `auth.test.ts` |
| Role change / deactivation revokes the user's sessions; "sign out of all devices" | ✅ | `rbac.test.ts` |
| Owner-only password reset for a team member: temporary password generated in the browser (crypto RNG), shown once, weak-password rules, signs them out everywhere, audited; never for your own account | ✅ | `rbac.test.ts`, `e2e/team.spec.ts` |
| Login throttle, agent-run budget and global rate limit in Redis (survive restarts, shared by API instances); global limit per signed-in user | ✅ | `window-store.redis.test.ts`, `rate-limit.test.ts` |

## Authorization
| Item | Status | Where |
|---|---|---|
| Every non-public route requires a session (automatic sweep of the route table) | ✅ | `route-security.test.ts` |
| Every mutation requires the CSRF token (automatic sweep) | ✅ | `route-security.test.ts` |
| A viewer can't mutate anything except their own session/password (automatic sweep) | ✅ | `route-security.test.ts` |
| Permission is checked before the request body is looked at (found and fixed: content status) | ✅ | sweep |
| Owner-only: users, automations, integrations; financial approvals; last owner can't be demoted | ✅ | `rbac.test.ts`, `approvals.test.ts`, `automations.test.ts` |

## Input, output, injection
| Item | Status | Where |
|---|---|---|
| All input validated with Zod; JSON only (text/plain removed); 1 MB body limit (256 KB webhook) | ✅ | |
| SQL only through the query builder / parameterised `sql` templates | ✅ | review |
| No stack traces or SQL in error responses | ✅ | `route-security.test.ts` |
| SSRF-safe web fetch (DNS pinning, private ranges blocked, size/time limits) | ✅ | `fetch.test.ts` |
| Env values used in URL paths are validated (Meta ad account id) | ✅ | `config` tests |
| Gmail drafts: no header injection | ✅ | `integrations.test.ts` |
| Prompt injection: customer text, web pages, MCP output labelled as data; risky actions need approval regardless | ✅ | agents tests |

## Agents, approvals, money
| Item | Status | Where |
|---|---|---|
| External/destructive/financial tools never run without approval; exactly-once execution | ✅ | `approvals.test.ts` |
| Automations can't send, publish or spend; can't mark leads won/lost; loop-free | ✅ | `automations.test.ts` |
| Agent-run budget per user (60/hour default) across tasks, triage and reports | ✅ | `cost-control.test.ts` |
| Report numbers can't be supplied by an agent | ✅ | `analytics.test.ts` |
| Meta Ads read-only (`ads_read` token; no write code exists) | ✅ / 👤 token scope | |

## Secrets & data
| Item | Status | Where |
|---|---|---|
| No secrets in the repository (scanner over every tracked file; masked output) | ✅ | `pnpm security:secrets`, `secret-scan.test.ts` |
| Integration pages show which variables are set, never values | ✅ | `integrations.test.ts` |
| OAuth tokens encrypted at rest (AES-256-GCM); tamper detected | ✅ | `secrets.test.ts` |
| Production refuses placeholder/short secrets, identical session/encryption keys, http:// URLs, mocks | ✅ | `config` tests |
| Audit log append-only **in the database** (trigger blocks UPDATE/DELETE/TRUNCATE) | ✅ | `route-security.test.ts` |
| App connects as a non-owner DB role (DML only), migrations as the owner → the trigger can't be dropped by the app; API/worker refuse to start as owner/superuser in production | ✅ | `app-role.test.ts`, CI `stack` job |
| Encryption key rotation: re-encrypt `integration_connections` with the new key, or disconnect/reconnect | 👤 documented | |
| Nightly backups (pg_dump, 14 days) and restore tested end-to-end in CI (wipe → restore → counts match → login works → grants intact) | ✅ | CI `stack` job |
| Encrypted off-server copy of the backups (e.g. rclone crypt to Google Drive) | 👤 documented | docs/DEPLOYMENT.md §7 |

## Transport & headers
| Item | Status | Where |
|---|---|---|
| API: CSP `default-src 'none'`, frame-ancestors none, nosniff, no-referrer, HSTS, Permissions-Policy, `Cache-Control: no-store` | ✅ | `route-security.test.ts` |
| CORS allow-list; credentials only for listed origins | ✅ | `security.test.ts` |
| Web app served by the API with its own CSP (no inline/eval scripts, same-origin only), HTTPS via Caddy, HTTP → HTTPS redirect, HSTS | ✅ | `web.test.ts`, `e2e/csp.spec.ts` (every page, zero violations) |

## Dependencies & supply chain
| Item | Status | Where |
|---|---|---|
| `pnpm audit`: 0 known vulnerabilities (dev-only esbuild advisory fixed by override) | ✅ | `pnpm security:audit` |
| Lockfile committed; MCP servers installed locally (no `npx` downloads at runtime) | ✅ | |
| Audit + secret scan in CI on every push | ✅ | `.github/workflows/ci.yml` |
| Runtime image without build/test tooling; runs as non-root; DB and Redis not exposed to the internet | ✅ | `Dockerfile`, `deploy/docker-compose.yml` |

## Manual checks before go-live
- [ ] Change the owner password created at setup; create personal accounts for staff (no shared logins).
- [ ] Meta system-user token has only `ads_read`; WhatsApp token belongs to a system user, not a person.
- [ ] Google OAuth consent screen in "Production" with only the listed scopes; Canva integration scopes match.
- [ ] Rotate any key that was ever pasted into chat, email or a ticket.
- [ ] Confirm the server clock and time zone (reports use Asia/Karachi calendar days).
