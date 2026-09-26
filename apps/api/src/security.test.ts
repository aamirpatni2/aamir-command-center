import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, PASSWORD, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp({
    global: { max: 10_000, timeWindow: "1 minute" },
    loginFailures: { max: 3, windowMs: 15 * 60_000 },
    loginIp: { max: 13, timeWindow: "15 minutes" },
  });
  await createUser(ctx, "owner", "owner@example.test");
});
afterAll(async () => teardown(ctx));

describe("security baseline", () => {
  it("health endpoint reports the database", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("sets secure headers and a request id", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("CORS only allows configured origins", async () => {
    const ok = await ctx.app.inject({ method: "OPTIONS", url: "/api/auth/login", headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const evil = await ctx.app.inject({ method: "OPTIONS", url: "/api/auth/login", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("successful logins don't consume the failure budget, and success resets it", async () => {
    const ok = () => ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "owner@example.test", password: PASSWORD } });
    const bad = () => ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "owner@example.test", password: "wrong" } });
    for (let i = 0; i < 4; i++) expect((await ok()).statusCode).toBe(200);
    expect((await bad()).statusCode).toBe(401);
    expect((await bad()).statusCode).toBe(401);
    expect((await ok()).statusCode).toBe(200); // resets the counter
  });

  it("locks an email after repeated failures, even with the right password", async () => {
    const attempt = (password = "wrong") =>
      ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "owner@example.test", password } });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await attempt()).statusCode);
    expect(codes).toEqual([401, 401, 401, 429]);
    const locked = await attempt(PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    // A different account from the same IP still gets its own budget.
    await createUser(ctx, "viewer", "other@example.test");
    const other = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "other@example.test", password: PASSWORD } });
    expect(other.statusCode).toBe(200);
  });

  it("caps total login requests per IP", async () => {
    // 13 per window in this suite; earlier tests used all 13 → next request from this IP is refused.
    const res = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "someone@example.test", password: "x" } });
    expect(res.statusCode).toBe(429);
  });

  it("unknown routes return JSON 404", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});
