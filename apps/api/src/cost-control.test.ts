import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, login, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

// Every request that starts an agent run can cost API credits: capped per user.
let ctx: TestContext;
beforeAll(async () => {
  ctx = await setupTestApp(
    { global: { max: 10_000, timeWindow: "1 minute" }, loginFailures: { max: 1_000, windowMs: 60_000 }, loginIp: { max: 1_000, timeWindow: "1 minute" }, agentRuns: { max: 2, windowMs: 3600_000 } },
    { ACC_ENABLE_MOCKS: "true" },
  );
  await createUser(ctx, "owner");
  await createUser(ctx, "admin");
});
afterAll(async () => ctx && teardown(ctx));

describe("agent-run cap", () => {
  it("is per user and shared across the endpoints that start agents", async () => {
    const owner = await login(ctx, "owner@example.test");
    const admin = await login(ctx, "admin@example.test");
    const task = (s: typeof owner) => ctx.app.inject({ method: "POST", url: "/api/tasks", headers: s.headers, payload: { input: "What courses do we offer?" } });
    const report = (s: typeof owner) => ctx.app.inject({ method: "POST", url: "/api/reports/agent", headers: s.headers, payload: { preset: "last_week", period: "weekly" } });
    expect((await task(owner)).statusCode).toBe(202);
    expect((await report(owner)).statusCode).toBe(202);
    const third = await task(owner);
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe("RATE_LIMITED");
    expect((await task(admin)).statusCode).toBe(202); // another user has their own budget
  });
});
