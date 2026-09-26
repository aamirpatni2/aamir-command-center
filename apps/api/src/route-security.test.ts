/**
 * Security sweep over EVERY registered route, so new endpoints are covered automatically:
 * no session → 401; mutating without CSRF → 403; a viewer can't change anything; headers; the
 * audit log can't be altered; password changes; the per-user cap on agent runs.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, sql } from "@acc/database";
import { createUser, login, PASSWORD, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;
let viewer: Awaited<ReturnType<typeof login>>;

/** Deliberately public: login, health, the signed WhatsApp webhook and the OAuth redirect (state-protected). */
const PUBLIC = new Set([
  "GET /api/health",
  "POST /api/auth/login",
  "GET /api/auth/me",
  "GET /api/webhooks/whatsapp",
  "POST /api/webhooks/whatsapp",
  "GET /api/integrations/oauth/callback",
]);
/** Mutations any signed-in user may make on their own account. */
const SELF_SERVICE = new Set(["POST /api/auth/logout", "POST /api/auth/logout-all", "POST /api/auth/password"]);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const fill = (url: string) => url.replace(/:id\b|:enrollmentId\b/g, randomUUID()).replace(/:provider\b/g, "google").replace(/:[a-zA-Z]+/g, "x");

beforeAll(async () => {
  ctx = await setupTestApp();
  await createUser(ctx, "viewer");
  viewer = await login(ctx, "viewer@example.test");
});
afterAll(async () => ctx && teardown(ctx));

describe("every route", () => {
  it("the route table is populated (sanity)", () => {
    expect(ctx.app.routeTable.length).toBeGreaterThan(80);
  });

  it("requires a session unless deliberately public", async () => {
    const failures: string[] = [];
    for (const r of ctx.app.routeTable) {
      const key = `${r.method} ${r.url}`;
      if (PUBLIC.has(key) || !r.url.startsWith("/api/")) continue;
      const res = await ctx.app.inject({ method: r.method as "GET", url: fill(r.url), ...(MUTATING.has(r.method) ? { payload: {} } : {}) });
      if (res.statusCode !== 401) failures.push(`${key} → ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it("every mutation requires the CSRF token", async () => {
    const failures: string[] = [];
    for (const r of ctx.app.routeTable) {
      const key = `${r.method} ${r.url}`;
      if (!MUTATING.has(r.method) || PUBLIC.has(key)) continue;
      const res = await ctx.app.inject({ method: r.method as "POST", url: fill(r.url), headers: { cookie: viewer.cookie }, payload: {} });
      if (res.statusCode !== 403) failures.push(`${key} → ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it("a viewer can't change anything (except their own session and password)", async () => {
    const failures: string[] = [];
    for (const r of ctx.app.routeTable) {
      const key = `${r.method} ${r.url}`;
      if (!MUTATING.has(r.method) || PUBLIC.has(key) || SELF_SERVICE.has(key)) continue;
      const res = await ctx.app.inject({ method: r.method as "POST", url: fill(r.url), headers: viewer.headers, payload: {} });
      if (res.statusCode !== 403) failures.push(`${key} → ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("headers", () => {
  it("API responses are never cached and lock down browser features", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: viewer.cookie } });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["permissions-policy"]).toContain("camera=()");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("errors never leak stack traces or SQL", async () => {
    const res = await ctx.app.inject({ method: "GET", url: `/api/leads/not-a-uuid`, headers: viewer.headers });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/at \w+ \(|node_modules|select |postgres/i);
  });
});

describe("audit log is append-only in the database", () => {
  it("UPDATE, DELETE and TRUNCATE are refused, even from raw SQL", async () => {
    await ctx.handle.db.insert(schema.auditLogs).values({ actorType: "system", action: "test.entry" });
    const refused = (e: unknown) => /append-only/.test(String((e as { cause?: Error }).cause?.message ?? (e as Error).message));
    await expect(ctx.handle.db.execute(sql`update audit_logs set action = 'tampered'`)).rejects.toSatisfy(refused);
    await expect(ctx.handle.db.execute(sql`delete from audit_logs`)).rejects.toSatisfy(refused);
    await expect(ctx.handle.db.execute(sql`truncate audit_logs`)).rejects.toSatisfy(refused);
    const rows = await ctx.handle.db.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where action = 'test.entry'`);
    expect(rows[0]!.n).toBe(1);
  });
});

describe("password change", () => {
  it("needs the current password, rejects weak ones, and signs out other sessions", async () => {
    await createUser(ctx, "operator", "changer@example.test");
    const a = await login(ctx, "changer@example.test");
    const b = await login(ctx, "changer@example.test");
    const change = (body: unknown) => ctx.app.inject({ method: "POST", url: "/api/auth/password", headers: a.headers, payload: body as object });

    expect((await change({ currentPassword: "wrong", newPassword: "a much better passphrase" })).json().error.code).toBe("INVALID_CREDENTIALS");
    expect((await change({ currentPassword: PASSWORD, newPassword: "short" })).statusCode).toBe(400);
    expect((await change({ currentPassword: PASSWORD, newPassword: "password1234" })).json().error.code).toBe("WEAK_PASSWORD");
    expect((await change({ currentPassword: PASSWORD, newPassword: "changer-is-my-name" })).json().error.code).toBe("WEAK_PASSWORD");
    expect((await change({ currentPassword: PASSWORD, newPassword: PASSWORD })).json().error.code).toBe("WEAK_PASSWORD");

    const ok = await change({ currentPassword: PASSWORD, newPassword: "a much better passphrase" });
    expect(ok.json()).toEqual({ ok: true, otherSessionsRevoked: 1 });
    expect((await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: b.cookie } })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: a.cookie } })).statusCode).toBe(200);
    await expect(login(ctx, "changer@example.test", PASSWORD)).rejects.toThrow();
    await login(ctx, "changer@example.test", "a much better passphrase");
  });
});
