/**
 * Background worker: executes queued agent tasks, and runs automations (events, schedules and the
 * 10-minute sweep for time-based triggers).
 */
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { loadEnv } from "@acc/config";
import { createDb, eq, isNull, schema } from "@acc/database";
import {
  AUTOMATION_QUEUE, MetaAdsClient, createAutomationQueue, defaultMcpConfigPath, loadMcpConfig, McpClientManager, OAuthService, REPO_ROOT, createDefaultToolRegistry, createTaskQueue, createWhatsappTriageTask, embedderFromEnv, executeTask,
  handleEvent, handleSchedule, handleSweep, modelAvailability, RedisEventSink, resolveModel, ruleFromRow, SWEEP_EVERY_MS, TASK_QUEUE, TRIAGE_JOB,
  webSearchFromEnv, type AutomationJob, type EngineDeps,
} from "@acc/agents";
import type { AutomationEvent } from "@acc/shared";

const env = loadEnv();
const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "worker" },
  ...(env.NODE_ENV === "production" ? {} : { transport: { target: "pino-pretty" } }),
});

const handle = createDb(env.DATABASE_URL, { max: 5 });
const publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const events = new RedisEventSink(publisher);
const webSearch = webSearchFromEnv(env);
const embedder = embedderFromEnv(env);
const oauth = new OAuthService({ db: handle.db, env, publicUrl: env.PUBLIC_URL });
const mcp = new McpClientManager(loadMcpConfig(defaultMcpConfigPath(REPO_ROOT, process.env)), {
  root: REPO_ROOT,
  log: (msg, meta) => logger.info(meta ?? {}, msg),
});
// MCP tools are registered now and offered to agents as soon as their server connects.
void mcp.start().then(() => logger.info({ servers: mcp.statuses().map((s) => `${s.id}:${s.state}`) }, "mcp servers"));
const ads = new MetaAdsClient({ accessToken: env.META_ADS_ACCESS_TOKEN, adAccountId: env.META_AD_ACCOUNT_ID, graphVersion: env.WHATSAPP_GRAPH_VERSION });
const tools = createDefaultToolRegistry({ webSearch, embedder, oauth, mcp, ads });
logger.info({ webSearch: webSearch?.id ?? "not configured", embeddings: embedder ? embedder.model : "not configured (full-text search only)" }, "integrations");

const availability = modelAvailability(env);
if (!availability.available) logger.warn({ reason: availability.reason }, "no model configured — tasks will fail until it is");
else if (availability.mock) logger.warn("ANTHROPIC_API_KEY not set: using the MOCK model (development only)");

const worker = new Worker<{ taskId?: string; conversationId?: string }>(
  TASK_QUEUE,
  async (job) => {
    let taskId = job.data.taskId;
    if (job.name === TRIAGE_JOB && job.data.conversationId) {
      const task = await createWhatsappTriageTask(handle.db, job.data.conversationId);
      if (!task) return { status: "skipped", reason: "conversation not found" };
      taskId = task.id;
    }
    if (!taskId) return { status: "skipped", reason: "no task" };
    const log = logger.child({ taskId, jobId: job.id, job: job.name });
    log.info("task picked up");
    const status = await executeTask(taskId, {
      db: handle.db,
      tools,
      events,
      logger: log,
      resolve: (selector) => resolveModel(env, selector),
    });
    log.info({ status }, "task finished");
    return { status };
  },
  { connection: { url: env.REDIS_URL }, concurrency: 2 },
);

worker.on("failed", async (job, err) => {
  logger.error({ err, taskId: job?.data.taskId, job: job?.name }, "task job crashed");
  // Unexpected crash outside the runner's own error handling: never leave the task stuck in RUNNING.
  if (job?.data.taskId) {
    await handle.db
      .update(schema.agentTasks)
      .set({ status: "FAILED", error: "Worker crashed while running this task. See logs.", finishedAt: new Date() })
      .where(eq(schema.agentTasks.id, job.data.taskId));
  }
});

// ── Automations ─────────────────────────────────────────────────────────
const taskQueue = createTaskQueue(env.REDIS_URL);
const automationQueue = createAutomationQueue(env.REDIS_URL);
const engine: EngineDeps = { db: handle.db, enqueueTask: (id) => taskQueue.enqueue(id) };

const automationWorker = new Worker<AutomationJob>(
  AUTOMATION_QUEUE,
  async (job) => {
    const log = logger.child({ job: job.name, jobId: job.id });
    const d = job.data;
    if (d.kind === "event" && d.event) {
      const out = await handleEvent(engine, d.event as AutomationEvent, d.ref ?? {});
      if (out.length) log.info({ event: d.event, results: out.map((o) => `${o.ruleId}:${o.outcome.status}`) }, "automation event handled");
      return { rules: out.length };
    }
    if (d.kind === "schedule" && d.ruleId) {
      // Scheduler jobs carry their planned time; manual runs carry "manual:<ts>".
      const firedAt = d.firedAt ?? new Date(job.timestamp + (job.opts.delay ?? 0)).toISOString();
      const outcome = await handleSchedule(engine, d.ruleId, firedAt);
      log.info({ ruleId: d.ruleId, status: outcome?.status ?? "skipped" }, "scheduled automation");
      return { status: outcome?.status ?? "skipped" };
    }
    if (d.kind === "sweep") {
      const r = await handleSweep(engine);
      if (r.fired) log.info(r, "automation sweep");
      return r;
    }
    return { status: "ignored" };
  },
  { connection: { url: env.REDIS_URL }, concurrency: 1 },
);
automationWorker.on("failed", (job, err) => logger.error({ err, job: job?.name, data: job?.data }, "automation job failed"));

/** The database is the source of truth for schedules: re-create repeatable jobs on every start. */
async function syncSchedules() {
  const rules = await handle.db.select().from(schema.automationRules).where(isNull(schema.automationRules.deletedAt));
  const wanted = new Set<string>();
  for (const r of rules) {
    const def = ruleFromRow(r);
    if (def.trigger.event !== "schedule") continue;
    const active = r.enabled;
    if (active) wanted.add(`rule:${r.id}`);
    await automationQueue.syncSchedule({ id: r.id, active, cron: def.trigger.cron, tz: def.trigger.tz });
  }
  for (const s of await automationQueue.queue.getJobSchedulers()) {
    if (s.key.startsWith("rule:") && !wanted.has(s.key)) await automationQueue.queue.removeJobScheduler(s.key);
  }
  await automationQueue.queue.upsertJobScheduler("sweep", { every: SWEEP_EVERY_MS }, { name: "sweep", data: { kind: "sweep" } });
  logger.info({ schedules: wanted.size }, "automation schedules synced");
}
syncSchedules().catch((err) => logger.error({ err }, "could not sync automation schedules"));


logger.info({ queues: [TASK_QUEUE, AUTOMATION_QUEUE] }, "worker started");

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutting down worker");
  await worker.close();
  await automationWorker.close();
  await mcp.close();
  await Promise.allSettled([taskQueue.close(), automationQueue.close()]);
  await publisher.quit();
  await handle.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
