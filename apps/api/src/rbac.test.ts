import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, login, PASSWORD, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof login>>;
let admin: Awaited<ReturnType<typeof login>>;
let operator: Awaited<ReturnType<typeof login>>;
let ownerId: string;

beforeAll(async () => {
  ctx = await setupTestApp();
  ownerId = (await createUser(ctx, "owner")).id;
  await createUser(ctx, "admin");
  await createUser(ctx, "operator");
  owner = await login(ctx, "owner@example.test");
  admin = await login(ctx, "admin@example.test");
  operator = await login(ctx, "operator@example.test");
});
afterAll(async () => teardown(ctx));

const newUser = { email: "new@example.test", name: "New Person", role: "viewer", password: "a-long-enough-password" };

describe("user management (RBAC)", () => {
  it("unauthenticated → 401", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/users" })).statusCode).toBe(401);
  });

  it("operator cannot list users → 403", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/users", headers: operator.headers })).statusCode).toBe(403);
  });

  it("admin can list but cannot create users", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/users", headers: admin.headers })).statusCode).toBe(200);
    const res = await ctx.app.inject({ method: "POST", url: "/api/users", headers: admin.headers, payload: newUser });
    expect(res.statusCode).toBe(403);
  });

  it("owner creates a user; duplicate email → 409; weak password → 400", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/api/users", headers: owner.headers, payload: newUser });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.passwordHash).toBeUndefined();
    const dup = await ctx.app.inject({ method: "POST", url: "/api/users", headers: owner.headers, payload: { ...newUser, email: "NEW@example.test" } });
    expect(dup.statusCode).toBe(409);
    const weak = await ctx.app.inject({ method: "POST", url: "/api/users", headers: owner.headers, payload: { ...newUser, email: "x@example.test", password: "short" } });
    expect(weak.statusCode).toBe(400);
  });

  it("owner cannot demote themselves (last-owner protection)", async () => {
    const res = await ctx.app.inject({ method: "PATCH", url: `/api/users/${ownerId}`, headers: owner.headers, payload: { role: "admin" } });
    expect(res.statusCode).toBe(403);
  });

  it("role change revokes the target's sessions", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      headers: owner.headers,
      payload: { ...newUser, email: "demote@example.test", role: "admin" },
    });
    const id = created.json().user.id;
    const s = await login(ctx, "demote@example.test", newUser.password);
    const res = await ctx.app.inject({ method: "PATCH", url: `/api/users/${id}`, headers: owner.headers, payload: { role: "viewer" } });
    expect(res.statusCode).toBe(200);
    expect((await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: s.cookie } })).statusCode).toBe(401);
  });

  it("invalid uuid param → 400", async () => {
    const res = await ctx.app.inject({ method: "PATCH", url: "/api/users/not-a-uuid", headers: owner.headers, payload: { name: "x" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("owner resets a team member's password", () => {
  it("only the owner, never for yourself, strong passwords only; signs them out and is audited", async () => {
    const target = await createUser(ctx, "operator", "forgot@example.test");
    const theirSession = await login(ctx, "forgot@example.test");
    const reset = (headers: Record<string, string>, id: string, password: string) =>
      ctx.app.inject({ method: "POST", url: `/api/users/${id}/password`, headers, payload: { password } });

    expect((await reset(admin.headers, target.id, "a-brand-new-passphrase")).statusCode).toBe(403);
    expect((await reset(operator.headers, target.id, "a-brand-new-passphrase")).statusCode).toBe(403);
    expect((await reset(owner.headers, ownerId, "a-brand-new-passphrase")).statusCode).toBe(403);
    expect((await reset(owner.headers, target.id, "short")).statusCode).toBe(400);
    expect((await reset(owner.headers, target.id, "password1234")).json().error.code).toBe("WEAK_PASSWORD");
    expect((await reset(owner.headers, "00000000-0000-4000-8000-000000000000", "a-brand-new-passphrase")).statusCode).toBe(404);

    const ok = await reset(owner.headers, target.id, "a-brand-new-passphrase");
    expect(ok.json()).toEqual({ ok: true });
    // Signed out everywhere; old password gone; new one works.
    expect((await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: theirSession.cookie } })).statusCode).toBe(401);
    await expect(login(ctx, "forgot@example.test", PASSWORD)).rejects.toThrow();
    await login(ctx, "forgot@example.test", "a-brand-new-passphrase");
    const audit = await ctx.app.inject({ method: "GET", url: "/api/audit-logs?action=user.password_reset", headers: owner.headers });
    expect(audit.json().auditLogs[0]).toMatchObject({ entityId: target.id });
  });
});

describe("audit log API", () => {
  it("owner can read audit logs that include user.create", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/audit-logs?action=user.create", headers: owner.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().auditLogs.length).toBeGreaterThan(0);
  });
  it("operator cannot read audit logs", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/audit-logs", headers: operator.headers })).statusCode).toBe(403);
  });
});

describe("integration status", () => {
  it("returns booleans only", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/health/integrations", headers: owner.headers });
    expect(res.statusCode).toBe(200);
    for (const v of Object.values(res.json().integrations)) expect(typeof v).toBe("boolean");
  });
});
