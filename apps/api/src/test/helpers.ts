import type { FastifyInstance } from "fastify";
import { envSchema } from "@acc/config";
import { createDb, hashPassword, schema, type DbHandle } from "@acc/database";
import { resetTestDatabase } from "@acc/database/testing";
import type { Role } from "@acc/shared";
import { McpClientManager, type AutomationQueue, type TaskQueue } from "@acc/agents";
import { buildApp } from "../app.js";
import { MemoryWindowStore } from "../lib/window-store.js";

export class MemoryQueue implements TaskQueue {
  readonly jobs: string[] = [];
  readonly triage: { conversationId: string; delayMs: number }[] = [];
  fail = false;
  async enqueueTriage(conversationId: string, delayMs: number) {
    this.triage.push({ conversationId, delayMs });
  }
  async enqueue(taskId: string) {
    if (this.fail) throw new Error("redis down");
    this.jobs.push(taskId);
  }
  async close() {}
}

/** Records automation events and schedule syncs instead of talking to Redis. */
export class MemoryAutomationQueue implements AutomationQueue {
  readonly events: { event: string; ref: Record<string, unknown>; refId: string }[] = [];
  readonly schedules = new Map<string, { active: boolean; cron?: string }>();
  readonly manualRuns: string[] = [];
  fail = false;
  async emit(event: string, ref: Record<string, unknown>, refId: string) {
    if (this.fail) throw new Error("redis down");
    this.events.push({ event, ref, refId });
  }
  async syncSchedule(rule: { id: string; active: boolean; cron?: string }) {
    if (this.fail) throw new Error("redis down");
    this.schedules.set(rule.id, { active: rule.active, cron: rule.cron });
  }
  async runNow(ruleId: string) {
    if (this.fail) throw new Error("redis down");
    this.manualRuns.push(ruleId);
  }
  async close() {}
}

export interface TestContext {
  app: FastifyInstance;
  handle: DbHandle;
  queue: MemoryQueue;
  automations: MemoryAutomationQueue;
}

export async function setupTestApp(
  rateLimit: Parameters<typeof buildApp>[0]["rateLimit"] = {
    global: { max: 10_000, timeWindow: "1 minute" },
    loginFailures: { max: 1_000, windowMs: 60_000 },
    loginIp: { max: 1_000, timeWindow: "1 minute" },
    agentRuns: { max: 10_000, windowMs: 60_000 },
  },
  envOverrides: Record<string, string> = {},
  extra: Pick<Parameters<typeof buildApp>[0], "whatsapp" | "mcp" | "oauthFetch" | "ads"> = {},
): Promise<TestContext> {
  const url = await resetTestDatabase();
  const env = envSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: url,
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    ACC_ENCRYPTION_KEY: "test-encryption-key-0123456789abcdef",
    LOG_LEVEL: "silent",
    ...envOverrides,
  });
  const queue = new MemoryQueue();
  const handle = createDb(url, { max: 5 });
  const automations = new MemoryAutomationQueue();
  // No MCP servers in API tests unless a test injects its own manager.
  const mcp = extra.mcp ?? new McpClientManager({ servers: [] }, { root: process.cwd() });
  const app = await buildApp({ env, db: handle.db, logger: false, rateLimit, limits: new MemoryWindowStore(), taskQueue: queue, automationQueue: automations, ...extra, mcp });
  await app.ready();
  return { app, handle, queue, automations };
}

export async function teardown(ctx: TestContext) {
  await ctx.app.close();
  await ctx.handle.close();
}

export const PASSWORD = "correct horse battery staple";

export async function createUser(ctx: TestContext, role: Role, email = `${role}@example.test`) {
  const [user] = await ctx.handle.db
    .insert(schema.users)
    .values({ email, name: `${role} user`, role, passwordHash: await hashPassword(PASSWORD) })
    .returning();
  return user!;
}

export async function login(ctx: TestContext, email: string, password = PASSWORD) {
  const res = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === "acc_session")!;
  const body = res.json() as { csrfToken: string };
  return {
    cookie: `acc_session=${cookie.value}`,
    csrfToken: body.csrfToken,
    headers: { cookie: `acc_session=${cookie.value}`, "x-csrf-token": body.csrfToken },
    raw: res,
  };
}
