import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { eq, schema, type DbHandle } from "@acc/database";
import { ToolRegistry } from "./registry.js";
import type { Tool } from "./types.js";
import { createTask, setupDb } from "../test/helpers.js";

let h: DbHandle;
let ctx: Parameters<ToolRegistry["execute"]>[2];

const echo: Tool<{ msg: string }, unknown> = { name: "test.echo", description: "echo", risk: "read", input: z.object({ msg: z.string() }), run: async (i) => ({ echoed: i.msg }) };
const send: Tool<{ to: string; text: string }, unknown> = {
  name: "test.send", description: "send a message", risk: "external",
  input: z.object({ to: z.string(), text: z.string() }),
  describe: (i) => `Send message to ${i.to}`,
  run: async () => { throw new Error("must never run without approval"); },
};
const slow: Tool<object, unknown> = { name: "test.slow", description: "slow", risk: "read", input: z.object({}), timeoutMs: 50, run: () => new Promise((r) => setTimeout(r, 500)) };
const broken: Tool<object, unknown> = { name: "test.broken", description: "broken (e.g. MCP server down)", risk: "read", input: z.object({}), run: async () => { throw new Error("ECONNREFUSED"); } };

const registry = new ToolRegistry().register(echo, send, slow, broken);
const ALL = ["test.echo", "test.send", "test.slow", "test.broken"];

beforeAll(async () => {
  h = await setupDb();
  const task = await createTask(h);
  const [run] = await h.db.insert(schema.agentRuns).values({ taskId: task.id, agentId: "sales" }).returning();
  ctx = { db: h.db, taskId: task.id, runId: run!.id, agentId: "sales", toolCallId: "c1" };
});
afterAll(async () => h?.close());

describe("ToolRegistry", () => {
  it("runs an allowed read tool", async () => {
    expect(await registry.execute(ALL, { id: "1", name: "test.echo", input: { msg: "hi" } }, ctx)).toEqual({ status: "ok", output: { echoed: "hi" } });
  });

  it("denies a tool outside the agent's allow-list and audits it", async () => {
    const r = await registry.execute(["test.echo"], { id: "2", name: "test.send", input: { to: "x", text: "y" } }, ctx);
    expect(r).toMatchObject({ status: "error", code: "NOT_ALLOWED" });
    const audits = await h.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "tool.denied"));
    expect(audits).toHaveLength(1);
  });

  it("rejects invalid input", async () => {
    expect(await registry.execute(ALL, { id: "3", name: "test.echo", input: { msg: 5 } }, ctx)).toMatchObject({ status: "error", code: "INVALID_INPUT" });
  });

  it("reports unknown tools", async () => {
    expect(await registry.execute(ALL, { id: "4", name: "nope", input: {} }, ctx)).toMatchObject({ code: "UNKNOWN_TOOL" });
  });

  it("external tool creates a pending approval instead of executing — idempotently", async () => {
    const call = { id: "call-ext", name: "test.send", input: { to: "+923001234567", text: "Salam" } };
    const a = await registry.execute(ALL, call, ctx);
    const b = await registry.execute(ALL, call, ctx); // retried step
    expect(a.status).toBe("approval_required");
    expect(b).toEqual(a);
    const rows = await h.db.select().from(schema.approvals);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", risk: "external", toolName: "test.send", title: "Send message to +923001234567" });
  });

  it("times out slow tools", async () => {
    expect(await registry.execute(ALL, { id: "5", name: "test.slow", input: {} }, ctx)).toMatchObject({ status: "error", code: "TIMEOUT" });
  });

  it("turns a failing integration into a tool error, not a crash", async () => {
    expect(await registry.execute(ALL, { id: "6", name: "test.broken", input: {} }, ctx)).toMatchObject({ status: "error", code: "FAILED" });
  });

  it("specs mark approval-gated tools and reject unknown grants", () => {
    const specs = registry.specsFor(["test.send"]);
    expect(specs[0]!.description).toContain("human approval");
    expect(specs[0]!.inputSchema).toMatchObject({ type: "object", required: ["to", "text"] });
    expect(() => registry.specsFor(["missing.tool"])).toThrow(/unknown tool/);
  });
});
