---
name: mcp-integration
description: Add or change an MCP server / external integration (WhatsApp, Google, Canva, Meta, web search, filesystem). Use before installing any MCP server or writing an adapter.
---
# MCP integration checklist
1. Confirm a milestone needs it. Only install what's required.
2. Add an entry to `docs/MCP_SERVERS.md`: purpose, server, tools, auth, permissions, risks, approval, env vars.
3. Add env var *names* to `.env.example` + `packages/config` (`integrationStatus`).
4. Register capabilities in `packages/mcp` with an explicit tool allow-list and risk per tool.
5. Missing credentials → `not_configured`, never a silent mock. Stop and tell the user exactly which credential is needed.
6. Tests: server down/timeout (circuit breaker), tool not allow-listed (denied + audit), external tool creates approval.
