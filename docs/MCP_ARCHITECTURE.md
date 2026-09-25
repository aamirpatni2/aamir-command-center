# MCP Architecture

## 1. Position in the system
MCP (Model Context Protocol) is the **integration layer for external systems**.
Agents never import a vendor SDK. They call capabilities in the `ToolRegistry`,
and the registry routes each one to an adapter:

```
Agent ──tool call──▶ ToolRegistry ──policy (allow-list, risk, approval)──▶ Adapter
                                                                        ├─ InternalAdapter (our Postgres)
                                                                        ├─ McpAdapter ──▶ McpClientManager ──▶ MCP server (stdio / HTTP)
                                                                        └─ MockAdapter (test only, mock:true)
```

## 2. Components (`packages/mcp`)
- **McpServerConfig**: id, transport (`stdio` | `streamable-http`), command/url, env var *names* (never values), exposed-tool allow-list, default risk per tool, `enabled`.
- **McpClientManager**: lazy connect, health check, timeout (default 30 s), circuit breaker (after 3 consecutive failures, skip the server for 60 s), reconnect.
- **Capability mapping**: `capabilities.ts` maps internal names → `{ server, tool, risk }`, e.g. `whatsapp.send → { server: "whatsapp", tool: "send_message", risk: "external" }`.
- **Result sanitising**: MCP results are wrapped as untrusted data before they go back to a model, with size limits and injection markers stripped.

## 3. Failure behaviour
| Failure | Behaviour |
|---|---|
| Server not configured (missing env) | capability reports `not_configured`; agent gets a clear tool error; UI shows "needs setup" in MCP Tools |
| Server down / timeout | retry once, then circuit-break; the run records the error and the Orchestrator can continue with partial results or fail the step |
| Tool not in allow-list | denied + audit log `mcp.tool.denied` |
| Result too large | truncated with a marker; full payload stored in `agent_messages` only if under 1 MB |

## 4. Least privilege
- A separate credential per server, with the narrowest scope the vendor offers (e.g. a WhatsApp system-user token for a single phone number ID, a read-only Meta Ads token for Marketing insights).
- Tools are allow-listed per server. Anything not listed stays hidden from agents even when the server exposes it.
- Per-agent access is set in the agent definition, not in the server config.

## 5. Developer MCP vs product MCP
- **Product MCP**: servers the running application connects to (listed in MCP_SERVERS.md), configured through env vars + `packages/mcp/src/servers.ts`.
- **Developer MCP**: servers Claude Code uses while building this repo (`.mcp.json`). None is required yet; this session already has GitHub access through the environment.

See **MCP_SERVERS.md** for the per-server catalogue.
