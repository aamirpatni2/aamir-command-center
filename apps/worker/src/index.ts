/**
 * Background worker: executes queued agent tasks, and runs automations (events, schedules and the
 * 10-minute sweep for time-based triggers).
 */
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { loadEnv } from "@acc/config";
import { createDb } from "@acc/database";
import {
  AUTOMATION_QUEUE, MetaAdsClient, createAutomationQueue, defaultMcpConfigPath, loadMcpConfig, McpClientManager, OAuthService, REPO_ROOT, createDefaultToolRegistry,
  createTaskQueue, embedderFromEnv, modelAvailability, RedisEventSink, resolveModel, TASK_QUEUE, webSearchFromEnv, type AutomationJob, type EngineDeps,
} from "@acc/agents";
import { markCrashed, processAutomationJob, processTaskJob, syncSchedules } from "./jobs.js";

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

const taskDeps = { db: handle.db, tools, events, logger, resolve: (selector?: { provider?: string; model?: string }) => resolveModel(env, selector) };
const worker = new Worker<{ taskId?: string; conversationId?: string }>(TASK_QUEUE, (job) => processTaskJob(taskDeps, job), {
  connection: { url: env.REDIS_URL },
  concurrency: 2,
});
worker.on("failed", async (job, err) => {
  logger.error({ err, taskId: job?.data.taskId, job: job?.name }, "task job crashed");
  if (job?.data.taskId) await markCrashed(handle.db, job.data.taskId);
});

// ── Automations ─────────────────────────────────────────────────────────
const taskQueue = createTaskQueue(env.REDIS_URL);
const automationQueue = createAutomationQueue(env.REDIS_URL);
const engine: EngineDeps = { db: handle.db, enqueueTask: (id) => taskQueue.enqueue(id) };
const automationWorker = new Worker<AutomationJob>(AUTOMATION_QUEUE, (job) => processAutomationJob(engine, job, logger), {
  connection: { url: env.REDIS_URL },
  concurrency: 1,
});
automationWorker.on("failed", (job, err) => logger.error({ err, job: job?.name, data: job?.data }, "automation job failed"));
syncSchedules(handle.db, automationQueue)
  .then((r) => logger.info(r, "automation schedules synced"))
  .catch((err) => logger.error({ err }, "could not sync automation schedules"));

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
