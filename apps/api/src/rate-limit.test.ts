import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, login, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setupTestApp({
    global: { max: 5, timeWindow: "1 minute" },
    loginFailures: { max: 100, windowMs: 60_000 },
    loginIp: { max: 100, timeWindow: "1 minute" },
    agentRuns: { max: 100, windowMs: 60_000 },
  });
});
afterAll(async () => ctx && teardown(ctx));

describe("global API rate limit", () => {
  it("is per signed-in user, so a team behind one office IP doesn't share a budget", async () => {
    await createUser(ctx, "operator", "one@example.test");
    await createUser(ctx, "operator", "two@example.test");
    const a = await login(ctx, "one@example.test");
    const b = await login(ctx, "two@example.test");
    const get = (cookie: string) => ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });

    for (let i = 0; i < 5; i++) expect((await get(a.cookie)).statusCode).toBe(200);
    const limited = await get(a.cookie);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    // Same IP (inject uses 127.0.0.1), different user: unaffected.
    expect((await get(b.cookie)).statusCode).toBe(200);
  });
});
