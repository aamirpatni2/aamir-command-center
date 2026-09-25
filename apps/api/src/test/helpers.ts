import type { FastifyInstance } from "fastify";
import { envSchema } from "@acc/config";
import { createDb, hashPassword, schema, type DbHandle } from "@acc/database";
import { resetTestDatabase } from "@acc/database/testing";
import type { Role } from "@acc/shared";
import type { TaskQueue } from "@acc/agents";
import { buildApp } from "../app.js";

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

export interface TestContext {
  app: FastifyInstance;
  handle: DbHandle;
  queue: MemoryQueue;
}

export async function setupTestApp(
  rateLimit: Parameters<typeof buildApp>[0]["rateLimit"] = {
    global: { max: 10_000, timeWindow: "1 minute" },
    loginFailures: { max: 1_000, windowMs: 60_000 },
    loginIp: { max: 1_000, timeWindow: "1 minute" },
  },
  envOverrides: Record<string, string> = {},
  extra: Pick<Parameters<typeof buildApp>[0], "whatsapp"> = {},
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
  const app = await buildApp({ env, db: handle.db, logger: false, rateLimit, taskQueue: queue, ...extra });
  await app.ready();
  return { app, handle, queue };
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
