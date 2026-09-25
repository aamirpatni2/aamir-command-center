import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, PASSWORD, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp({ global: { max: 10_000, timeWindow: "1 minute" }, login: { max: 3, timeWindow: "15 minutes" } });
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

  it("rate-limits repeated login attempts for the same email", async () => {
    const attempt = () =>
      ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "owner@example.test", password: "wrong" } });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await attempt()).statusCode);
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429]);
    // A different account from the same IP still gets its own budget.
    await createUser(ctx, "viewer", "other@example.test");
    const other = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "other@example.test", password: PASSWORD } });
    expect(other.statusCode).toBe(200);
  });

  it("unknown routes return JSON 404", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});
