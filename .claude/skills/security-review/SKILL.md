---
name: security-review
description: Review a change for security issues specific to this project (auth, RBAC, CSRF, secrets, webhooks, agent tool permissions, prompt injection). Use before merging anything touching API routes, auth, tools or integrations.
---
# Security review checklist
- [ ] Every route: Zod input, `requireAuth(permission)`, correct permission for the action.
- [ ] State-changing routes rely on the CSRF check (no GET that mutates).
- [ ] No secret in code, logs, errors, test fixtures or the web bundle.
- [ ] Audit log written for sensitive actions; no secrets/PII bodies in metadata.
- [ ] New tools declare risk; risky ones route to approvals; no bypass flags.
- [ ] External content treated as data; cannot change agent permissions.
- [ ] Webhooks: HMAC on raw body, replay/dup protection.
- [ ] Tests for 401/403/400 and the specific abuse case.
Reference: `docs/SECURITY_MODEL.md`.
