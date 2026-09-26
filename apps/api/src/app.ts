import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { Env } from "@acc/config";
import type { Database } from "@acc/database";
import { HttpError } from "./lib/errors.js";
import { AgentRunLimiter } from "./lib/rate-limits.js";
import { RedisWindowStore, type WindowStore } from "./lib/window-store.js";
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
import { integrationRoutes } from "./routes/integrations.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { registerWeb } from "./routes/web.js";
import { TaskEventHub } from "./lib/task-events.js";
import {
  createAutomationQueue, createTaskQueue, MetaAdsClient, defaultMcpConfigPath, loadMcpConfig, McpClientManager, OAuthService, REPO_ROOT, WhatsAppClient,
  type AutomationQueue, type TaskQueue,
} from "@acc/agents";

export interface BuildAppOptions {
  env: Env;
  db: Database;
  /** Overrides for tests. */
  rateLimit?: {
    global?: { max: number; timeWindow: string };
    loginFailures?: { max: number; windowMs: number };
    loginIp?: { max: number; timeWindow: string };
    /** Requests that start agent runs, per user (cost control). */
    agentRuns?: { max: number; windowMs: number };
  };
  /** Throttle counters. Defaults to Redis (REDIS_URL) so limits survive restarts; tests use memory. */
  limits?: WindowStore;
  logger?: boolean;
  /** Defaults to the BullMQ queue on REDIS_URL. Tests inject an in-memory queue. */
  taskQueue?: TaskQueue;
  /** Defaults to the real Cloud API client from env. Tests inject one with a fake fetch. */
  whatsapp?: WhatsAppClient;
  /** Defaults to the BullMQ automations queue. Tests inject an in-memory one. */
  automationQueue?: AutomationQueue;
  /** Defaults to the servers in mcp.config.json. Tests inject their own. */
  mcp?: McpClientManager;
  /** Network for OAuth providers (tests inject a fake). */
  oauthFetch?: typeof fetch;
  /** Read-only Meta ads client (tests inject one with a fake fetch). */
  ads?: MetaAdsClient;
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
    // API responses carry personal data: never store them in shared or browser caches.
    if (req.url.startsWith("/api/") && !reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(cors, { origin: env.WEB_ORIGINS, credentials: true });
  await app.register(cookie);
  const limits = opts.limits ?? new RedisWindowStore(env.REDIS_URL);
  app.addHook("onClose", async () => {
    await limits.close();
  });
  await app.register(rateLimit, {
    ...(opts.rateLimit?.global ?? { max: env.RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" }),
    hook: "preHandler", // so per-route key generators can read the parsed body
    // Per signed-in user (a team behind one office IP shouldn't share a budget), else per IP.
    // req.ip is undefined once the client has hung up (aborted fetches on navigation).
    keyGenerator: (req) => (req.auth ? `user:${req.auth.user.id}` : `ip:${req.ip ?? "disconnected"}`),
    // Shared counters in Redis; if Redis is briefly unreachable, don't lock everyone out.
    ...(limits instanceof RedisWindowStore ? { redis: limits.redis, nameSpace: "acc:rl:", skipOnError: true } : {}),
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

  // Production: the API also serves the built dashboard from the same origin (WEB_DIST_DIR).
  const webFallback = env.WEB_DIST_DIR ? await registerWeb(app, env.WEB_DIST_DIR) : null;
  app.setNotFoundHandler((req, reply) => webFallback?.(req, reply) ?? reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } }));

  // Every registered route, for the security sweep test (auth / CSRF / RBAC on all endpoints).
  const routeTable: { method: string; url: string }[] = [];
  app.decorate("routeTable", routeTable);
  app.addHook("onRoute", (r) => {
    for (const method of [r.method].flat()) if (method !== "HEAD" && method !== "OPTIONS") routeTable.push({ method, url: r.url });
  });

  const runs = opts.rateLimit?.agentRuns ?? { max: 60, windowMs: 3600_000 };
  app.decorate("agentRuns", new AgentRunLimiter(limits, runs.max, runs.windowMs));

  await app.register(healthRoutes, { db });
  await app.register(authRoutes, {
    db,
    loginFailures: opts.rateLimit?.loginFailures ?? { max: 5, windowMs: 15 * 60_000 },
    loginIpRateLimit: opts.rateLimit?.loginIp ?? { max: env.LOGIN_IP_LIMIT, timeWindow: "15 minutes" },
    limits,
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
    new WhatsAppClient({ accessToken: env.WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID, graphVersion: env.WHATSAPP_GRAPH_VERSION });
  const oauth = new OAuthService({ db, env, publicUrl: env.PUBLIC_URL, fetchImpl: opts.oauthFetch });
  const mcp = opts.mcp ?? new McpClientManager(loadMcpConfig(defaultMcpConfigPath(REPO_ROOT, process.env)), { root: REPO_ROOT, log: (msg, meta) => app.log.info(meta, msg) });
  // Approved MCP actions execute here (the API runs approvals); connecting happens in the background.
  mcp.registerApprovalExecutors();
  if (!opts.mcp) void mcp.start();
  app.addHook("onClose", async () => {
    await mcp.close();
  });
  await app.register(approvalRoutes, { db, whatsapp, oauth, events: hub });
  await app.register(integrationRoutes, { db, env, oauth, mcp, whatsapp });
  const ads = opts.ads ?? new MetaAdsClient({ accessToken: env.META_ADS_ACCESS_TOKEN, adAccountId: env.META_AD_ACCOUNT_ID, graphVersion: env.WHATSAPP_GRAPH_VERSION });
  await app.register(analyticsRoutes, { db, ads, queue });
  await app.register(automationRoutes, { db, automations });

  return app;
}
