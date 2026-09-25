import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AGENTS, modelAvailability, type TaskQueue } from "@acc/agents";
import type { Env } from "@acc/config";
import { and, asc, desc, eq, inArray, schema, sql, writeAudit, type Database } from "@acc/database";
import { AGENT_IDS, TASK_STATUSES } from "@acc/shared";
import { HttpError, notFound, parse } from "../lib/errors.js";
import { auditMeta } from "../lib/audit.js";
import type { TaskEventHub } from "../lib/task-events.js";
import { requireAuth } from "../plugins/auth.js";

export interface TaskRouteOptions {
  db: Database;
  env: Env;
  queue: TaskQueue;
  hub: TaskEventHub;
}

const createSchema = z.object({
  input: z.string().trim().min(3).max(4000),
  title: z.string().trim().min(1).max(160).optional(),
});
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const runsQuery = z.object({
  agentId: z.enum(AGENT_IDS).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const OPEN = ["QUEUED", "RUNNING", "WAITING_APPROVAL"] as const;
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export async function taskRoutes(app: FastifyInstance, opts: TaskRouteOptions) {
  const { db, env, queue, hub } = opts;

  app.get("/api/agents", { preHandler: requireAuth("tasks:read") }, async () => ({
    agents: Object.values(AGENTS).map((a) => ({
      id: a!.id,
      description: a!.description,
      limitations: a!.limitations ?? null,
      tools: a!.tools,
      maxSteps: a!.maxSteps,
      model: a!.model?.model ?? env.DEFAULT_MODEL,
      effort: a!.effort ?? null,
    })),
    model: modelAvailability(env),
  }));

  app.post("/api/tasks", { preHandler: requireAuth("tasks:create") }, async (req, reply) => {
    const body = parse(createSchema, req.body);
    const availability = modelAvailability(env);
    if (!availability.available) throw new HttpError(503, "MODEL_NOT_CONFIGURED", availability.reason ?? "No model configured");

    const [task] = await db
      .insert(schema.agentTasks)
      .values({ title: body.title ?? body.input.split("\n")[0]!.slice(0, 120), input: body.input, requestedBy: req.auth!.user.id, source: "user" })
      .returning();
    await writeAudit(db, { ...auditMeta(req), action: "task.create", entityType: "agent_task", entityId: task!.id, metadata: { mock: availability.mock } });
    try {
      await queue.enqueue(task!.id);
    } catch (err) {
      req.log.error({ err }, "enqueue failed");
      await db.update(schema.agentTasks).set({ status: "FAILED", error: "Task queue unavailable (is Redis running?)" }).where(eq(schema.agentTasks.id, task!.id));
      throw new HttpError(503, "QUEUE_UNAVAILABLE", "The task queue is unavailable. Is Redis running?");
    }
    return reply.code(202).send({ task, mock: availability.mock });
  });

  app.get("/api/tasks", { preHandler: requireAuth("tasks:read") }, async (req) => {
    const q = parse(listQuery, req.query);
    const tasks = await db
      .select({
        id: schema.agentTasks.id,
        title: schema.agentTasks.title,
        status: schema.agentTasks.status,
        source: schema.agentTasks.source,
        error: schema.agentTasks.error,
        createdAt: schema.agentTasks.createdAt,
        startedAt: schema.agentTasks.startedAt,
        finishedAt: schema.agentTasks.finishedAt,
        requestedBy: schema.users.name,
      })
      .from(schema.agentTasks)
      .leftJoin(schema.users, eq(schema.users.id, schema.agentTasks.requestedBy))
      .where(q.status ? eq(schema.agentTasks.status, q.status) : undefined)
      .orderBy(desc(schema.agentTasks.createdAt))
      .limit(q.limit);
    return { tasks };
  });

  app.get("/api/tasks/:id", { preHandler: requireAuth("tasks:read") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [row] = await db
      .select({ task: schema.agentTasks, requestedByName: schema.users.name })
      .from(schema.agentTasks)
      .leftJoin(schema.users, eq(schema.users.id, schema.agentTasks.requestedBy))
      .where(eq(schema.agentTasks.id, id));
    if (!row) throw notFound("Task");
    const task = { ...row.task, requestedBy: row.requestedByName };
    const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.taskId, id)).orderBy(asc(schema.agentRuns.createdAt));
    const messages = runs.length
      ? await db
          .select({
            runId: schema.agentMessages.runId,
            seq: schema.agentMessages.seq,
            role: schema.agentMessages.role,
            toolName: schema.agentMessages.toolName,
            toolRisk: schema.agentMessages.toolRisk,
            isError: schema.agentMessages.isError,
            latencyMs: schema.agentMessages.latencyMs,
            content: schema.agentMessages.content,
            createdAt: schema.agentMessages.createdAt,
          })
          .from(schema.agentMessages)
          .where(inArray(schema.agentMessages.runId, runs.map((r) => r.id)))
          .orderBy(asc(schema.agentMessages.runId), asc(schema.agentMessages.seq))
      : [];
    const approvals = await db
      .select({ id: schema.approvals.id, title: schema.approvals.title, risk: schema.approvals.risk, status: schema.approvals.status })
      .from(schema.approvals)
      .where(eq(schema.approvals.taskId, id));
    const steps = await db
      .select({
        id: schema.agentSteps.id,
        position: schema.agentSteps.position,
        agentId: schema.agentSteps.agentId,
        instruction: schema.agentSteps.instruction,
        dependsOn: schema.agentSteps.dependsOn,
        status: schema.agentSteps.status,
      })
      .from(schema.agentSteps)
      .where(eq(schema.agentSteps.taskId, id))
      .orderBy(asc(schema.agentSteps.position));
    // The system prompt is configuration, not run output: omit its body from the timeline.
    const timeline = messages.map((m) => (m.role === "system" ? { ...m, content: { text: "(system prompt)" } } : m));
    return { task, steps, runs, messages: timeline, approvals };
  });

  app.post("/api/tasks/:id/cancel", { preHandler: requireAuth("tasks:cancel") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [task] = await db
      .update(schema.agentTasks)
      .set({ status: "CANCELLED", finishedAt: new Date() })
      .where(and(eq(schema.agentTasks.id, id), inArray(schema.agentTasks.status, [...OPEN])))
      .returning();
    if (!task) {
      const [exists] = await db.select({ status: schema.agentTasks.status }).from(schema.agentTasks).where(eq(schema.agentTasks.id, id));
      if (!exists) throw notFound("Task");
      throw new HttpError(409, "CONFLICT", `Task is already ${exists.status}`);
    }
    await writeAudit(db, { ...auditMeta(req), action: "task.cancel", entityType: "agent_task", entityId: id });
    await hub.publish({ type: "task.status", taskId: id, status: "CANCELLED" }).catch(() => {});
    return { task };
  });

  /** Agent Activity: one row per agent run. */
  app.get("/api/agent-runs", { preHandler: requireAuth("tasks:read") }, async (req) => {
    const q = parse(runsQuery, req.query);
    const rows = await db
      .select({
        id: schema.agentRuns.id,
        agentId: schema.agentRuns.agentId,
        status: schema.agentRuns.status,
        taskId: schema.agentRuns.taskId,
        taskTitle: schema.agentTasks.title,
        modelProvider: schema.agentRuns.modelProvider,
        model: schema.agentRuns.model,
        startedAt: schema.agentRuns.startedAt,
        finishedAt: schema.agentRuns.finishedAt,
        latencyMs: schema.agentRuns.latencyMs,
        inputTokens: schema.agentRuns.inputTokens,
        outputTokens: schema.agentRuns.outputTokens,
        costMicroUsd: schema.agentRuns.costMicroUsd,
        toolCallCount: schema.agentRuns.toolCallCount,
        errorCode: schema.agentRuns.errorCode,
        errorMessage: schema.agentRuns.errorMessage,
        resultText: sql<string | null>`left(${schema.agentRuns.output}->>'text', 240)`,
        toolsUsed: sql<string[]>`coalesce((select array_agg(distinct m.tool_name) from agent_messages m where m.run_id = "agent_runs"."id" and m.tool_name is not null), '{}')`,
      })
      .from(schema.agentRuns)
      .innerJoin(schema.agentTasks, eq(schema.agentTasks.id, schema.agentRuns.taskId))
      .where(
        and(
          q.agentId ? eq(schema.agentRuns.agentId, q.agentId) : undefined,
          q.status ? eq(schema.agentRuns.status, q.status) : undefined,
        ),
      )
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(q.limit);
    return { runs: rows.map((r) => ({ ...r, mock: r.modelProvider === "mock" })) };
  });

  /** Server-Sent Events: live status/steps for one task. */
  app.get("/api/tasks/:id/events", { preHandler: requireAuth("tasks:read"), config: { rateLimit: false } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [task] = await db.select({ status: schema.agentTasks.status }).from(schema.agentTasks).where(eq(schema.agentTasks.id, id));
    if (!task) throw notFound("Task");

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-request-id": req.id,
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("snapshot", { taskId: id, status: task.status });
    if (TERMINAL.has(task.status)) {
      res.end();
      return;
    }
    const unsubscribe = hub.subscribe(id, (event) => {
      send(event.type, event);
      if (event.type === "task.status" && TERMINAL.has(event.status)) cleanup();
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    let closed = false;
    function cleanup() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    }
    req.raw.on("close", cleanup);
  });
}
