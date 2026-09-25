/**
 * Background worker: takes queued agent tasks from Redis and executes them.
 */
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { loadEnv } from "@acc/config";
import { createDb, eq, schema } from "@acc/database";
import { createDefaultToolRegistry, createWhatsappTriageTask, embedderFromEnv, executeTask, modelAvailability, RedisEventSink, resolveModel, TASK_QUEUE, TRIAGE_JOB, webSearchFromEnv } from "@acc/agents";

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
const tools = createDefaultToolRegistry({ webSearch, embedder });
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

logger.info({ queue: TASK_QUEUE }, "worker started");

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutting down worker");
  await worker.close();
  await publisher.quit();
  await handle.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
