import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema, type DbHandle } from "@acc/database";
import { MockProvider } from "../model/mock.js";
import { ModelNotConfiguredError } from "../model/types.js";
import { resolveModel } from "../model/registry.js";
import { createDefaultToolRegistry } from "../index.js";
import { executeTask } from "./execute-task.js";
import { MemoryEventSink } from "./events.js";
import { createTask, setupDb, silentLogger } from "../test/helpers.js";

let h: DbHandle;
beforeAll(async () => (h = await setupDb()));
afterAll(async () => h?.close());

const deps = (resolve: Parameters<typeof executeTask>[1]["resolve"], events = new MemoryEventSink()) => ({
  db: h.db, tools: createDefaultToolRegistry(), events, logger: silentLogger, resolve,
});

describe("executeTask", () => {
  it("runs the orchestrator and completes the task", async () => {
    const task = await createTask(h, "What courses do we offer?");
    const mock = new MockProvider(); // demo behaviour: kb.search then answer
    const events = new MemoryEventSink();
    const status = await executeTask(task.id, deps(() => ({ provider: mock, model: "mock" }), events));
    expect(status).toBe("COMPLETED");
    const [t] = await h.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, task.id));
    expect(t).toMatchObject({ status: "COMPLETED" });
    expect(t!.result).toMatchObject({ mock: true });
    expect((t!.result as { text: string }).text).toContain("[MOCK]");
    expect(mock.calls[0]!.messages[0]).toMatchObject({ role: "user" });
    expect((mock.calls[0]!.messages[0] as { content: string }).content).toContain("Pakistan time");
    expect(events.events[0]).toMatchObject({ type: "task.status", status: "RUNNING" });
    expect(events.events.at(-1)).toMatchObject({ type: "task.status", status: "COMPLETED" });
  });

  it("is idempotent: a duplicate job for the same task does nothing", async () => {
    const task = await createTask(h);
    const mock = new MockProvider([{ text: "done" }]);
    await executeTask(task.id, deps(() => ({ provider: mock, model: "mock" })));
    expect(await executeTask(task.id, deps(() => ({ provider: mock, model: "mock" })))).toBeNull();
    expect(mock.calls).toHaveLength(1);
  });

  it("fails clearly when no model is configured", async () => {
    const task = await createTask(h);
    const status = await executeTask(task.id, deps(() => { throw new ModelNotConfiguredError("anthropic", "ANTHROPIC_API_KEY"); }));
    expect(status).toBe("FAILED");
    const [t] = await h.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, task.id));
    expect(t!.error).toContain("ANTHROPIC_API_KEY");
  });
});

describe("resolveModel", () => {
  const base = { DEFAULT_MODEL_PROVIDER: "anthropic" as const, DEFAULT_MODEL: "claude-opus-5", NODE_ENV: "development" as const };
  it("uses Anthropic when a key is present", () => {
    const r = resolveModel({ ...base, ANTHROPIC_API_KEY: "sk-ant-test", ACC_ENABLE_MOCKS: false });
    expect(r.provider.id).toBe("anthropic");
    expect(r.model).toBe("claude-opus-5");
  });
  it("falls back to the labelled mock only when mocks are enabled", () => {
    expect(resolveModel({ ...base, ANTHROPIC_API_KEY: undefined, ACC_ENABLE_MOCKS: true }).provider.isMock).toBe(true);
    expect(() => resolveModel({ ...base, ANTHROPIC_API_KEY: undefined, ACC_ENABLE_MOCKS: false })).toThrow(/ANTHROPIC_API_KEY/);
  });
  it("never uses mocks in production", () => {
    expect(() => resolveModel({ ...base, NODE_ENV: "production", ANTHROPIC_API_KEY: undefined, ACC_ENABLE_MOCKS: true })).toThrow();
  });
});
