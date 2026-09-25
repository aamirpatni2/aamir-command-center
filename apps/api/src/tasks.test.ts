import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { createDefaultToolRegistry, executeTask, MemoryEventSink, MockProvider, taskChannel } from "@acc/agents";
import { count, eq, schema } from "@acc/database";
import pino from "pino";
import { createUser, login, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
let ctx: TestContext;
let operator: Awaited<ReturnType<typeof login>>;
let viewer: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  ctx = await setupTestApp(undefined, { ACC_ENABLE_MOCKS: "true", REDIS_URL });
  await createUser(ctx, "operator");
  await createUser(ctx, "viewer");
  operator = await login(ctx, "operator@example.test");
  viewer = await login(ctx, "viewer@example.test");
});
afterAll(async () => ctx && teardown(ctx));

const runWorker = (taskId: string, mock = new MockProvider()) =>
  executeTask(taskId, {
    db: ctx.handle.db, tools: createDefaultToolRegistry(), events: new MemoryEventSink(),
    logger: pino({ level: "silent" }), resolve: () => ({ provider: mock, model: "mock" }),
  });

describe("tasks API", () => {
  it("GET /api/agents lists the orchestrator and reports the mock model", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/agents", headers: viewer.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().agents.map((a: { id: string }) => a.id)).toContain("orchestrator");
    expect(res.json().model).toEqual({ available: true, mock: true });
  });

  it("creates and enqueues a task (202)", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/api/tasks", headers: operator.headers, payload: { input: "What courses do we offer?" } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ mock: true, task: { status: "QUEUED", title: "What courses do we offer?" } });
    expect(ctx.queue.jobs).toContain(res.json().task.id);
  });

  it("viewer cannot create tasks; invalid input and missing CSRF are rejected", async () => {
    expect((await ctx.app.inject({ method: "POST", url: "/api/tasks", headers: viewer.headers, payload: { input: "hello there" } })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "POST", url: "/api/tasks", headers: operator.headers, payload: { input: "" } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "POST", url: "/api/tasks", headers: { cookie: operator.cookie }, payload: { input: "hello there" } })).statusCode).toBe(403);
  });

  it("queue outage → 503 and the task is marked FAILED (not stuck QUEUED)", async () => {
    ctx.queue.fail = true;
    const res = await ctx.app.inject({ method: "POST", url: "/api/tasks", headers: operator.headers, payload: { input: "queue is down test" } });
    ctx.queue.fail = false;
    expect(res.statusCode).toBe(503);
    const [row] = await ctx.handle.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.input, "queue is down test"));
    expect(row!.status).toBe("FAILED");
  });

  it("task detail shows runs, tool steps and hides the system prompt body", async () => {
    const created = await ctx.app.inject({ method: "POST", url: "/api/tasks", headers: operator.headers, payload: { input: "Course fee kitni hai?" } });
    const id = created.json().task.id;
    expect(await runWorker(id)).toBe("COMPLETED");

    const res = await ctx.app.inject({ method: "GET", url: `/api/tasks/${id}`, headers: viewer.headers });
    const body = res.json();
    expect(body.task.status).toBe("COMPLETED");
    expect(body.task.requestedBy).toBe("operator user"); // a name, never an internal id
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ agentId: "orchestrator", modelProvider: "mock", toolCallCount: 1 });
    expect(body.messages.find((m: { role: string }) => m.role === "system").content).toEqual({ text: "(system prompt)" });
    expect(body.messages.some((m: { toolName: string }) => m.toolName === "kb.search")).toBe(true);

    const runs = await ctx.app.inject({ method: "GET", url: "/api/agent-runs", headers: viewer.headers });
    expect(runs.json().runs[0]).toMatchObject({ agentId: "orchestrator", status: "COMPLETED", mock: true, toolsUsed: ["kb.search"], taskTitle: "Course fee kitni hai?" });
  });

  it("cancel: open task → CANCELLED; again → 409; the worker then skips it", async () => {
    const created = await ctx.app.inject({ method: "POST", url: "/api/tasks", headers: operator.headers, payload: { input: "cancel me please" } });
    const id = created.json().task.id;
    const c1 = await ctx.app.inject({ method: "POST", url: `/api/tasks/${id}/cancel`, headers: operator.headers });
    expect(c1.statusCode).toBe(200);
    const c2 = await ctx.app.inject({ method: "POST", url: `/api/tasks/${id}/cancel`, headers: operator.headers });
    expect(c2.statusCode).toBe(409);
    expect(await runWorker(id)).toBeNull();
  });

  it("list filters by status", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/tasks?status=CANCELLED", headers: viewer.headers });
    expect(res.json().tasks.every((t: { status: string }) => t.status === "CANCELLED")).toBe(true);
    expect((await ctx.app.inject({ method: "GET", url: "/api/tasks?status=NOPE", headers: viewer.headers })).statusCode).toBe(400);
  });
});

describe("task events (SSE)", () => {
  it("streams live events and closes when the task finishes", async () => {
    const created = await ctx.app.inject({ method: "POST", url: "/api/tasks", headers: operator.headers, payload: { input: "stream me" } });
    const id = created.json().task.id;
    const address = await ctx.app.listen({ port: 0, host: "127.0.0.1" });

    const res = await fetch(`${address}/api/tasks/${id}/events`, { headers: { cookie: viewer.cookie } });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil("event: snapshot");

    const pub = new Redis(REDIS_URL);
    await new Promise((r) => setTimeout(r, 200)); // let the subscription settle
    await pub.publish(taskChannel(id), JSON.stringify({ type: "run.started", taskId: id, runId: "r1", agentId: "orchestrator", model: "mock", mock: true }));
    await pub.publish(taskChannel(id), JSON.stringify({ type: "task.status", taskId: id, status: "COMPLETED" }));
    await readUntil("COMPLETED");
    const { done } = await reader.read(); // server ends the stream after a terminal status
    await pub.quit();

    expect(text).toContain("event: run.started");
    expect(text).toContain("event: task.status");
    expect(done).toBe(true);
  });

  it("requires auth and a real task", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/tasks/00000000-0000-0000-0000-000000000000/events" })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "GET", url: "/api/tasks/00000000-0000-0000-0000-000000000000/events", headers: viewer.headers })).statusCode).toBe(404);
  });
});

describe("without a model", () => {
  it("POST /api/tasks → 503 MODEL_NOT_CONFIGURED and nothing is created", async () => {
    const other = await setupTestApp(undefined, { ACC_ENABLE_MOCKS: "false", REDIS_URL });
    try {
      await createUser(other, "owner");
      const s = await login(other, "owner@example.test");
      const res = await other.app.inject({ method: "POST", url: "/api/tasks", headers: s.headers, payload: { input: "anything at all" } });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toMatchObject({ code: "MODEL_NOT_CONFIGURED" });
      expect(res.json().error.message).toContain("ANTHROPIC_API_KEY");
      const [n] = await other.handle.db.select({ n: count() }).from(schema.agentTasks);
      expect(n!.n).toBe(0);
    } finally {
      await teardown(other);
    }
  });
});
