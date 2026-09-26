import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { asc, eq, schema, type DbHandle } from "@acc/database";
import { MockProvider } from "../model/mock.js";
import { ToolRegistry } from "../tools/registry.js";
import { INTERNAL_TOOLS } from "../tools/internal.js";
import type { AgentDefinition } from "../definitions/types.js";
import { AgentRunner } from "./runner.js";
import { MemoryEventSink } from "./events.js";
import { createTask, setupDb, silentLogger } from "../test/helpers.js";

let h: DbHandle;
const sendTool = {
  name: "whatsapp.send", description: "send", risk: "external" as const,
  input: z.object({ to: z.string(), text: z.string() }), run: async () => ({}),
};
const tools = new ToolRegistry().register(...INTERNAL_TOOLS, sendTool);
const agent: AgentDefinition = { id: "sales", description: "t", systemPrompt: "You are a test agent.", tools: ["kb.search", "memory.propose", "whatsapp.send"], maxSteps: 4 };

beforeAll(async () => {
  h = await setupDb();
  await h.db.insert(schema.knowledgeDocuments).values([
    { title: "Practical AI course fee", category: "pricing", body: "The Practical AI course fee is PKR 8,000.", status: "approved", approvedAt: new Date() },
    { title: "Draft AI course discount", category: "pricing", body: "Unapproved draft: 90% discount", status: "draft" },
  ]);
});
afterAll(async () => h?.close());

function runner(events = new MemoryEventSink()) {
  return { r: new AgentRunner({ db: h.db, tools, events, logger: silentLogger }), events };
}

describe("AgentRunner", () => {
  it("runs the tool loop, persists every message, and completes", async () => {
    const task = await createTask(h, "What is the AI course fee?");
    const mock = new MockProvider([
      { text: "Let me check.", toolCalls: [{ name: "kb.search", input: { query: "AI course fee" } }] },
      (req) => {
        const last = req.messages.at(-1);
        expect(last?.role).toBe("tool_results");
        return { text: "The fee is PKR 8,000 (from approved knowledge)." };
      },
    ]);
    const { r, events } = runner();
    const res = await r.run({ taskId: task.id, agent, input: task.input, provider: mock, model: "mock" });

    expect(res.status).toBe("COMPLETED");
    expect(res.text).toContain("PKR 8,000");
    // Draft knowledge must never reach the model.
    expect(JSON.stringify(mock.calls[1]!.messages)).not.toContain("90% discount");

    const [run] = await h.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, res.runId));
    expect(run).toMatchObject({ status: "COMPLETED", modelProvider: "mock", toolCallCount: 1, agentId: "sales" });
    expect(run!.latencyMs).toBeGreaterThanOrEqual(0);
    const msgs = await h.db.select().from(schema.agentMessages).where(eq(schema.agentMessages.runId, res.runId)).orderBy(asc(schema.agentMessages.seq));
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(msgs[3]).toMatchObject({ toolName: "kb.search", toolRisk: "read", isError: false });
    expect(events.events.map((e) => e.type)).toEqual(["run.started", "run.step", "run.step", "run.step", "run.step", "run.step", "run.finished"]);
  });

  it("an external action ends the run as WAITING_APPROVAL, never executed", async () => {
    const task = await createTask(h, "Reply to Ali on WhatsApp");
    const mock = new MockProvider([
      { toolCalls: [{ name: "whatsapp.send", input: { to: "+923001112233", text: "Walaikum salam!" } }] },
      { text: "I've drafted the reply; it's waiting for your approval." },
    ]);
    const res = await runner().r.run({ taskId: task.id, agent, input: task.input, provider: mock, model: "mock" });
    expect(res.status).toBe("WAITING_APPROVAL");
    expect(res.approvalIds).toHaveLength(1);
    const toolResult = mock.calls[1]!.messages.at(-1);
    expect(JSON.stringify(toolResult)).toContain("submitted_for_approval");
  });

  it("a tool outside the allow-list is refused and the model is told", async () => {
    const task = await createTask(h);
    const mock = new MockProvider([{ toolCalls: [{ name: "whatsapp.send", input: { to: "x", text: "y" } }] }, { text: "I can't do that." }]);
    const limited: AgentDefinition = { ...agent, tools: ["kb.search"] };
    const res = await runner().r.run({ taskId: task.id, agent: limited, input: "x", provider: mock, model: "mock" });
    expect(res.status).toBe("COMPLETED");
    expect(JSON.stringify(mock.calls[1]!.messages.at(-1))).toContain("NOT_ALLOWED");
    expect(await h.db.select().from(schema.approvals).where(eq(schema.approvals.runId, res.runId))).toHaveLength(0);
  });

  it("fails with MODEL_REFUSAL on a refusal", async () => {
    const task = await createTask(h);
    const res = await runner().r.run({ taskId: task.id, agent, input: "x", provider: new MockProvider([{ refusal: true }]), model: "mock" });
    expect(res).toMatchObject({ status: "FAILED", errorCode: "MODEL_REFUSAL" });
  });

  it("stops at maxSteps", async () => {
    const task = await createTask(h);
    const loop = Array.from({ length: 10 }, () => ({ toolCalls: [{ name: "kb.search", input: { query: "again" } }] }));
    const res = await runner().r.run({ taskId: task.id, agent: { ...agent, maxSteps: 3 }, input: "x", provider: new MockProvider(loop), model: "mock" });
    expect(res).toMatchObject({ status: "FAILED", errorCode: "MAX_STEPS" });
    const [run] = await h.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, res.runId));
    expect(run!.toolCallCount).toBe(3);
  });

  it("stops when the task is cancelled", async () => {
    const task = await createTask(h);
    await h.db.update(schema.agentTasks).set({ status: "CANCELLED" }).where(eq(schema.agentTasks.id, task.id));
    const res = await runner().r.run({ taskId: task.id, agent, input: "x", provider: new MockProvider([{ text: "hi" }]), model: "mock" });
    expect(res).toMatchObject({ status: "CANCELLED", errorCode: "CANCELLED" });
  });

  it("validates structured output through the finish tool (retry on invalid)", async () => {
    const task = await createTask(h);
    const structured: AgentDefinition = { ...agent, outputSchema: z.object({ ideas: z.array(z.string()).length(3) }) };
    const mock = new MockProvider([
      { toolCalls: [{ name: "finish", input: { ideas: ["only one"] } }] },
      { toolCalls: [{ name: "finish", input: { ideas: ["a", "b", "c"] } }] },
    ]);
    const res = await runner().r.run({ taskId: task.id, agent: structured, input: "3 ideas", provider: mock, model: "mock" });
    expect(res.status).toBe("COMPLETED");
    expect(res.output).toEqual({ ideas: ["a", "b", "c"] });
    expect(mock.calls[0]!.tools.map((t) => t.name)).toContain("finish");
  });

  it("memory.propose stores unvalidated memory as proposed only", async () => {
    const task = await createTask(h);
    const mock = new MockProvider([
      { toolCalls: [{ name: "memory.propose", input: { kind: "preference", subject: "tone", content: "Prefers Roman Urdu for WhatsApp" } }] },
      { text: "Noted." },
    ]);
    await runner().r.run({ taskId: task.id, agent, input: "x", provider: mock, model: "mock" });
    const [m] = await h.db.select().from(schema.memoryItems);
    expect(m).toMatchObject({ status: "proposed", source: "agent" });
  });
});
