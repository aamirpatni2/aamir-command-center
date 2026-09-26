import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { Env } from "@acc/config";
import type { Database } from "@acc/database";
import { HttpError } from "./lib/errors.js";
import { authPlugin } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { auditRoutes } from "./routes/audit.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { taskRoutes } from "./routes/tasks.js";
import { crmRoutes } from "./routes/crm.js";
import { educationRoutes } from "./routes/education.js";
import { contentRoutes } from "./routes/content.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { whatsappWebhookRoutes } from "./routes/webhooks.js";
import { approvalRoutes } from "./routes/approvals.js";
import { automationRoutes } from "./routes/automations.js";
import { TaskEventHub } from "./lib/task-events.js";
import { createAutomationQueue, createTaskQueue, WhatsAppClient, type AutomationQueue, type TaskQueue } from "@acc/agents";

export interface BuildAppOptions {
  env: Env;
  db: Database;
  /** Overrides for tests. */
  rateLimit?: {
    global?: { max: number; timeWindow: string };
    loginFailures?: { max: number; windowMs: number };
    loginIp?: { max: number; timeWindow: string };
  };
  logger?: boolean;
  /** Defaults to the BullMQ queue on REDIS_URL. Tests inject an in-memory queue. */
  taskQueue?: TaskQueue;
  /** Defaults to the real Cloud API client from env. Tests inject one with a fake fetch. */
  whatsapp?: WhatsAppClient;
  /** Defaults to the BullMQ automations queue. Tests inject an in-memory one. */
  automationQueue?: AutomationQueue;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { env, db } = opts;
  const isProd = env.NODE_ENV === "production";

  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: ["req.headers.cookie", "req.headers.authorization", 'req.headers["x-csrf-token"]', "res.headers['set-cookie']"],
            ...(isProd ? {} : { transport: { target: "pino-pretty" } }),
          },
    genReqId: (req) => {
      const incoming = req.headers["x-request-id"];
      return typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    },
    bodyLimit: 1_048_576,
    trustProxy: isProd,
  });

  // Only JSON bodies: text/plain is a CORS "simple" content type and would bypass preflight.
  app.removeContentTypeParser("text/plain");

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(cors, { origin: env.WEB_ORIGINS, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, {
    ...(opts.rateLimit?.global ?? { max: 300, timeWindow: "1 minute" }),
    hook: "preHandler", // so per-route key generators can read the parsed body
  });
  await app.register(authPlugin, {
    db,
    secret: env.SESSION_SECRET,
    ttlDays: env.SESSION_TTL_DAYS,
    absoluteTtlDays: env.SESSION_ABSOLUTE_TTL_DAYS,
    secureCookies: isProd,
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const code = status === 429 ? "RATE_LIMITED" : "BAD_REQUEST";
      return reply.code(status).send({ error: { code, message: (err as Error).message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Something went wrong", requestId: req.id } });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } }));

  await app.register(healthRoutes, { db });
  await app.register(authRoutes, {
    db,
    loginFailures: opts.rateLimit?.loginFailures ?? { max: 5, windowMs: 15 * 60_000 },
    loginIpRateLimit: opts.rateLimit?.loginIp ?? { max: 30, timeWindow: "15 minutes" },
  });
  await app.register(userRoutes, { db });
  await app.register(auditRoutes, { db });
  await app.register(dashboardRoutes, { db });

  const queue = opts.taskQueue ?? createTaskQueue(env.REDIS_URL);
  const hub = new TaskEventHub(env.REDIS_URL);
  const automations = opts.automationQueue ?? createAutomationQueue(env.REDIS_URL);
  app.addHook("onClose", async () => {
    await Promise.allSettled([queue.close(), hub.close(), automations.close()]);
  });
  await app.register(taskRoutes, { db, env, queue, hub });
  await app.register(crmRoutes, { db, env, queue, automations });
  await app.register(educationRoutes, { db, automations });
  await app.register(contentRoutes, { db });
  await app.register(knowledgeRoutes, { db, env });
  await app.register(whatsappWebhookRoutes, { db, env, queue, automations });
  const whatsapp =
    opts.whatsapp ??
    new WhatsAppClient({ accessToken: env.WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, graphVersion: env.WHATSAPP_GRAPH_VERSION });
  await app.register(approvalRoutes, { db, whatsapp, events: hub });
  await app.register(automationRoutes, { db, automations });

  return app;
}
