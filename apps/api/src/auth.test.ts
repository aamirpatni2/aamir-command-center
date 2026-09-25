import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq, schema } from "@acc/database";
import { createUser, login, PASSWORD, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
  await createUser(ctx, "owner", "aamir@example.test");
});
afterAll(async () => teardown(ctx));

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials and sets a hardened cookie", async () => {
    const { raw } = await login(ctx, "Aamir@Example.test"); // email is case-insensitive
    const cookie = raw.cookies.find((c) => c.name === "acc_session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Strict");
    const body = raw.json();
    expect(body.user).toMatchObject({ email: "aamir@example.test", role: "owner" });
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.csrfToken).toEqual(expect.any(String));
    expect(body.permissions).toContain("users:manage");
  });

  it("stores only a hash of the session token", async () => {
    const { raw } = await login(ctx, "aamir@example.test");
    const token = raw.cookies.find((c) => c.name === "acc_session")!.value;
    const rows = await ctx.handle.db.select().from(schema.sessions);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
  });

  it("returns the same generic error for wrong password and unknown email", async () => {
    const bad = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "aamir@example.test", password: "nope" } });
    const unknown = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ghost@example.test", password: PASSWORD } });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json().error.message).toBe(unknown.json().error.message);
  });

  it("audits failed logins", async () => {
    const rows = await ctx.handle.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "auth.login_failed"))
      .orderBy(desc(schema.auditLogs.createdAt));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
  });

  it("rejects invalid input with 400", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "not-an-email" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects text/plain bodies (CORS simple-request bypass)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "text/plain" },
      payload: JSON.stringify({ email: "aamir@example.test", password: PASSWORD }),
    });
    expect(res.statusCode).toBe(415);
  });

  it("refuses inactive users", async () => {
    const u = await createUser(ctx, "viewer", "inactive@example.test");
    await ctx.handle.db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, u.id));
    const res = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "inactive@example.test", password: PASSWORD } });
    expect(res.statusCode).toBe(401);
  });
});

describe("session lifecycle", () => {
  it("GET /api/auth/me requires a session", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/auth/me" })).statusCode).toBe(401);
  });

  it("me → logout → me is 401", async () => {
    const s = await login(ctx, "aamir@example.test");
    const me = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: s.cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().csrfToken).toBe(s.csrfToken);

    const out = await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: s.headers });
    expect(out.statusCode).toBe(204);
    const after = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: s.cookie } });
    expect(after.statusCode).toBe(401);
  });

  it("logout without CSRF token is rejected", async () => {
    const s = await login(ctx, "aamir@example.test");
    const res = await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: s.cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("CSRF_INVALID");
    const wrong = await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: s.cookie, "x-csrf-token": "forged" } });
    expect(wrong.statusCode).toBe(403);
  });

  it("logout-all revokes every session of the user", async () => {
    const a = await login(ctx, "aamir@example.test");
    const b = await login(ctx, "aamir@example.test");
    const res = await ctx.app.inject({ method: "POST", url: "/api/auth/logout-all", headers: a.headers });
    expect(res.statusCode).toBe(204);
    const me = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: b.cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("expired sessions are rejected", async () => {
    const s = await login(ctx, "aamir@example.test");
    await ctx.handle.db.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    const me = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: s.cookie } });
    expect(me.statusCode).toBe(401);
  });
});
