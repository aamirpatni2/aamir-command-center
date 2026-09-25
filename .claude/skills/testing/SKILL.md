---
name: testing
description: Write or run tests for this repo (Vitest unit/integration against the acc_test Postgres database, agent tests with MockProvider).
---
# Testing
- Run: `pnpm test` (all) · `pnpm vitest run apps/api` (one area). Postgres must be running with `acc_test` created.
- API tests: `setupTestApp()`, `createUser()`, `login()` from `apps/api/src/test/helpers.ts`; use `app.inject`.
- Test files run sequentially (shared DB). Each file resets the DB in `beforeAll`.
- Must-cover cases per project brief: agent routing, tool permissions, approvals, failed MCP server, invalid input, duplicate lead, duplicate message, webhook replay, unauthorized action.
