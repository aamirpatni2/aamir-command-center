import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@acc/database";
import { ToolRegistry } from "../tools/registry.js";
import { runApprovedAction } from "../approvals/executors.js";
import { WhatsAppClient } from "../integrations/whatsapp/client.js";
import { createTask, setupDb } from "../test/helpers.js";
import { mcpConfigSchema, type McpConfig } from "./config.js";
import { McpClientManager } from "./manager.js";

// Real MCP round trips against the official filesystem server (installed in the repo), plus failures.
const ROOT = resolve(import.meta.dirname, "../../../..");
const dir = mkdtempSync(join(tmpdir(), "acc-mcp-"));
writeFileSync(join(dir, "batch.txt"), "Batch 3 starts 1 November.");

const config: McpConfig = mcpConfigSchema.parse({
  servers: [
    {
      id: "files",
      label: "Course files",
      transport: "stdio",
      command: "mcp-server-filesystem",
      args: [dir],
      tools: {
        read_text_file: { risk: "read", agents: ["course"] },
        list_directory: { risk: "read", agents: ["course"] },
        write_file: { risk: "external", agents: ["course"] },
        not_a_real_tool: { risk: "read", agents: ["course"] },
      },
    },
    { id: "broken", label: "Broken server", transport: "stdio", command: "definitely-not-a-command-acc", tools: { anything: { risk: "read", agents: ["course"] } } },
    { id: "needs-token", label: "Needs a token", transport: "http", url: "https://example.invalid/mcp", requires: ["ACC_TEST_MISSING_TOKEN"], tools: { x: { risk: "read", agents: ["course"] } } },
    { id: "offline", label: "Offline HTTP", transport: "http", url: "http://127.0.0.1:9/mcp", tools: { y: { risk: "read", agents: ["course"] } } },
    { id: "off", label: "Switched off", transport: "stdio", command: "mcp-server-filesystem", enabled: false, tools: {} },
  ],
});

let manager: McpClientManager;
let h: DbHandle;
let taskId: string;

beforeAll(async () => {
  h = await setupDb();
  taskId = (await createTask(h)).id;
  manager = new McpClientManager(config, { root: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME }, connectTimeoutMs: 8_000 });
  await manager.start();
}, 30_000);
afterAll(async () => {
  await manager?.close();
  await h?.close();
});

describe("config", () => {
  it("rejects duplicate ids, bad names and unknown risks", () => {
    const base = { id: "a", label: "A server", transport: "stdio", command: "x" };
    expect(mcpConfigSchema.safeParse({ servers: [base, base] }).success).toBe(false);
    expect(mcpConfigSchema.safeParse({ servers: [{ ...base, id: "Bad Id" }] }).success).toBe(false);
    expect(mcpConfigSchema.safeParse({ servers: [{ ...base, tools: { a__b: { risk: "read" } } }] }).success).toBe(false);
    expect(mcpConfigSchema.safeParse({ servers: [{ ...base, tools: { t: { risk: "godmode" } } }] }).success).toBe(false);
  });

  it("the committed mcp.config.json is valid", () => {
    expect(mcpConfigSchema.safeParse(JSON.parse(readFileSync(join(ROOT, "mcp.config.json"), "utf8"))).success).toBe(true);
  });
});

describe("connections and failures", () => {
  it("connects the real server and exposes only allow-listed tools", () => {
    const s = manager.status("files");
    expect(s.state).toBe("connected");
    expect(s.tools.find((t) => t.name === "read_text_file")).toMatchObject({ available: true, risk: "read", readOnlyHint: true });
    expect(s.tools.find((t) => t.name === "not_a_real_tool")!.available).toBe(false);
    expect(s.unlistedTools).toContain("move_file"); // offered by the server, never exposed
  });

  it("a server that can't start, one missing credentials, an offline one and a disabled one are reported, not fatal", () => {
    expect(manager.status("broken")).toMatchObject({ state: "error", error: expect.any(String) });
    expect(manager.status("needs-token")).toMatchObject({ state: "not_configured", missing: ["ACC_TEST_MISSING_TOKEN"] });
    expect(manager.status("offline")).toMatchObject({ state: "error" });
    expect(manager.status("off").state).toBe("disabled");
    expect(manager.status("files").state).toBe("connected");
  });

  it("reconnect (the UI's Test button) works and re-reports failure honestly", async () => {
    expect((await manager.connect("broken")).state).toBe("error");
    expect((await manager.connect("files")).state).toBe("connected");
  }, 20_000);
});

describe("through the ToolRegistry", () => {
  const registry = () => {
    const r = new ToolRegistry().register(...manager.tools());
    for (const [agent, names] of manager.grants()) r.grant(agent, names);
    return r;
  };

  it("granted agents see available MCP tools with the server's own schema; others see nothing", () => {
    const r = registry();
    const allowed = r.allowedFor("course", []);
    expect(allowed).toContain("mcp.files.read_text_file");
    const specs = r.specsFor(allowed);
    const names = specs.map((s) => s.name);
    expect(names).toContain("mcp.files.read_text_file");
    expect(names).not.toContain("mcp.broken.anything"); // server down → hidden
    expect(names).not.toContain("mcp.files.not_a_real_tool");
    expect(specs.find((s) => s.name === "mcp.files.read_text_file")!.inputSchema).toMatchObject({ type: "object", properties: { path: expect.any(Object) } });
    expect(specs.find((s) => s.name === "mcp.files.write_file")!.description).toMatch(/needs human approval/);
    expect(r.allowedFor("sales", ["kb.search"])).toEqual(["kb.search"]);
  });

  it("reads through MCP; path traversal is refused by the server; other agents are denied", async () => {
    const r = registry();
    const ctx = { db: h.db, taskId, runId: "00000000-0000-4000-8000-000000000001", agentId: "course" as const, toolCallId: "c1" };
    const ok = await r.execute(r.allowedFor("course", []), { id: "c1", name: "mcp.files.read_text_file", input: { path: join(dir, "batch.txt") } }, ctx);
    expect(ok).toMatchObject({ status: "ok", output: { source: "mcp", content: "Batch 3 starts 1 November." } });
    const escape = await r.execute(r.allowedFor("course", []), { id: "c2", name: "mcp.files.read_text_file", input: { path: join(ROOT, ".env") } }, ctx);
    expect(escape).toMatchObject({ status: "error", code: "FAILED" });
    expect((escape as { message: string }).message).toMatch(/denied|outside/i);
    const down = await r.execute(r.allowedFor("course", []), { id: "c3", name: "mcp.broken.anything", input: {} }, ctx);
    expect(down).toMatchObject({ status: "error", message: expect.stringMatching(/unavailable/) });
  });

  it("risky MCP tools become approvals and run only through the approval executor", async () => {
    manager.registerApprovalExecutors();
    const target = join(dir, "approved.txt");
    const payload = { path: target, content: "written after approval" };
    const approval = { id: "a1", payload, editedPayload: null };
    const deps = { db: h.db, whatsapp: new WhatsAppClient({ graphVersion: "v21.0" }) };
    expect(await runApprovedAction("mcp.files.write_file", approval, deps)).toMatchObject({ status: "executed" });
    expect(readFileSync(target, "utf8")).toBe("written after approval");
    // Server refuses (outside its folder) → nothing happened, retryable.
    expect(await runApprovedAction("mcp.files.write_file", { ...approval, payload: { path: join(ROOT, "x.txt"), content: "no" } }, deps)).toMatchObject({ status: "not_executed", code: "PROVIDER_REJECTED" });
    await manager.disconnect("files");
    expect(await runApprovedAction("mcp.files.write_file", approval, deps)).toMatchObject({ status: "not_executed", code: "NOT_CONFIGURED" });
    await manager.connect("files");
  }, 20_000);
});
