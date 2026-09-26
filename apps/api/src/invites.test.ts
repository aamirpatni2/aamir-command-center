import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema } from "@acc/database";
import { MemoryMailer } from "./lib/mailer.js";
import { createUser, login, PASSWORD, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof login>>;
let ownerId: string;
const mailer = new MemoryMailer("smtp");
const tokenFrom = (text: string) => /\/invite#([A-Za-z0-9_-]{43})/.exec(text)![1]!;
const lastToken = () => tokenFrom(mailer.sent.at(-1)!.text);

beforeAll(async () => {
  ctx = await setupTestApp(undefined, { PUBLIC_URL: "https://command.example.test" }, { mailer });
  ownerId = (await createUser(ctx, "owner")).id;
  await createUser(ctx, "admin");
  owner = await login(ctx, "owner@example.test");
});
afterAll(async () => ctx && teardown(ctx));

const post = (url: string, payload: object, headers: Record<string, string> = owner.headers) => ctx.app.inject({ method: "POST", url, headers, payload });
const publicPost = (url: string, payload: object) => ctx.app.inject({ method: "POST", url, payload });

describe("email invites", () => {
  it("add with invite → email with a fragment link → lookup → set password → sign in; single use", async () => {
    const res = await post("/api/users", { email: "Invitee@Example.test", name: "Sana Invitee", role: "operator", sendInvite: true });
    expect(res.statusCode).toBe(201);
    expect(res.json().invite).toMatchObject({ status: "sent", expiresAt: expect.any(String) });
    const mail = mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: "invitee@example.test", subject: expect.stringContaining("invited") });
    expect(mail.text).toContain("https://command.example.test/invite#");
    expect(mail.text).toContain("as operator");
    expect(mail.html).not.toContain("<script");
    const token = lastToken();
    // Only a hash is stored.
    const rows = await ctx.handle.db.select().from(schema.userTokens);
    expect(JSON.stringify(rows)).not.toContain(token);

    // Nobody knows the placeholder password: they can't sign in before accepting.
    const list = await ctx.app.inject({ method: "GET", url: "/api/users", headers: owner.headers });
    expect(list.json().emailMode).toBe("smtp");
    expect(list.json().users.find((u: { email: string }) => u.email === "invitee@example.test").invite).toMatchObject({ expired: false });

    expect((await publicPost("/api/invites/lookup", { token })).json()).toMatchObject({ purpose: "invite", name: "Sana Invitee", email: "invitee@example.test" });
    expect((await publicPost("/api/invites/accept", { token, password: "short" })).statusCode).toBe(400);
    expect((await publicPost("/api/invites/accept", { token, password: "invitee-rocks-123" })).json().error.code).toBe("WEAK_PASSWORD");
    // A weak attempt doesn't burn the link.
    const ok = await publicPost("/api/invites/accept", { token, password: "a-strong-new-passphrase" });
    expect(ok.json()).toEqual({ ok: true, email: "invitee@example.test", purpose: "invite" });
    await login(ctx, "invitee@example.test", "a-strong-new-passphrase");

    // Used: it can't be used again, and it no longer shows as pending.
    expect((await publicPost("/api/invites/accept", { token, password: "another-passphrase-1" })).json().error.code).toBe("INVALID_LINK");
    expect((await publicPost("/api/invites/lookup", { token })).json().error.code).toBe("INVALID_LINK");
    const after = await ctx.app.inject({ method: "GET", url: "/api/users", headers: owner.headers });
    expect(after.json().users.find((u: { email: string }) => u.email === "invitee@example.test").invite).toBeNull();
    const audit = await ctx.app.inject({ method: "GET", url: "/api/audit-logs?action=user.invite_accepted", headers: owner.headers });
    expect(audit.json().auditLogs).toHaveLength(1);
  });

  it("resend replaces the old link; email change and deactivation void open links; joined people can't be re-invited", async () => {
    const created = await post("/api/users", { email: "resend@example.test", name: "Resend Me", role: "viewer", sendInvite: true });
    const id = created.json().user.id;
    const first = lastToken();
    expect((await post(`/api/users/${id}/invite`, {})).json().invite.status).toBe("sent");
    const second = lastToken();
    expect(second).not.toBe(first);
    expect((await publicPost("/api/invites/lookup", { token: first })).statusCode).toBe(400);
    expect((await publicPost("/api/invites/lookup", { token: second })).statusCode).toBe(200);

    await ctx.app.inject({ method: "PATCH", url: `/api/users/${id}`, headers: owner.headers, payload: { email: "resend2@example.test" } });
    expect((await publicPost("/api/invites/lookup", { token: second })).statusCode).toBe(400);

    await post(`/api/users/${id}/invite`, {});
    const third = lastToken();
    expect(mailer.sent.at(-1)!.to).toBe("resend2@example.test");
    await ctx.app.inject({ method: "PATCH", url: `/api/users/${id}`, headers: owner.headers, payload: { isActive: false } });
    expect((await publicPost("/api/invites/lookup", { token: third })).statusCode).toBe(400);
    expect((await post(`/api/users/${id}/invite`, {})).json().error.code).toBe("INACTIVE");

    expect((await post(`/api/users/${ownerId}/invite`, {})).json().error.code).toBe("ALREADY_JOINED");
  });

  it("expired links don't work", async () => {
    const created = await post("/api/users", { email: "late@example.test", name: "Late", role: "viewer", sendInvite: true });
    const token = lastToken();
    await ctx.handle.db.update(schema.userTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.userTokens.userId, created.json().user.id));
    expect((await publicPost("/api/invites/accept", { token, password: "a-strong-new-passphrase" })).json().error.code).toBe("INVALID_LINK");
    const list = await ctx.app.inject({ method: "GET", url: "/api/users", headers: owner.headers });
    expect(list.json().users.find((u: { email: string }) => u.email === "late@example.test").invite).toMatchObject({ expired: true });
  });

  it("validation: invite xor password; only the owner; malformed tokens rejected", async () => {
    expect((await post("/api/users", { email: "x1@example.test", name: "X", role: "viewer" })).statusCode).toBe(400);
    expect((await post("/api/users", { email: "x2@example.test", name: "X", role: "viewer", sendInvite: true, password: "a-strong-new-passphrase" })).statusCode).toBe(400);
    const admin = await login(ctx, "admin@example.test");
    expect((await post("/api/users", { email: "x3@example.test", name: "X", role: "viewer", sendInvite: true }, admin.headers)).statusCode).toBe(403);
    expect((await publicPost("/api/invites/lookup", { token: "abc" })).statusCode).toBe(400);
    expect((await publicPost("/api/invites/lookup", { token: "A".repeat(43) })).json().error.code).toBe("INVALID_LINK");
  });
});

describe("reset links", () => {
  it("owner emails a reset link: 1 hour, signs the person out everywhere, old password stops working", async () => {
    const target = await createUser(ctx, "operator", "forgetful@example.test");
    const session = await login(ctx, "forgetful@example.test");
    expect((await post(`/api/users/${ownerId}/reset-link`, {})).statusCode).toBe(403);
    const res = await post(`/api/users/${target.id}/reset-link`, {});
    expect(res.json().link.status).toBe("sent");
    expect(new Date(res.json().link.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(3600_000);
    expect(mailer.sent.at(-1)!.subject).toContain("Reset");
    const token = lastToken();
    expect((await publicPost("/api/invites/lookup", { token })).json().purpose).toBe("reset");
    expect((await publicPost("/api/invites/accept", { token, password: "brand-new-passphrase-9" })).json().ok).toBe(true);
    expect((await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: session.cookie } })).statusCode).toBe(401);
    await expect(login(ctx, "forgetful@example.test", PASSWORD)).rejects.toThrow();
    await login(ctx, "forgetful@example.test", "brand-new-passphrase-9");
  });

  it("a temporary-password reset voids an emailed link", async () => {
    const target = await createUser(ctx, "operator", "both@example.test");
    await post(`/api/users/${target.id}/reset-link`, {});
    const token = lastToken();
    await post(`/api/users/${target.id}/password`, { password: "owner-set-passphrase-1" });
    expect((await publicPost("/api/invites/lookup", { token })).statusCode).toBe(400);
  });
});

describe("when email isn't set up or fails", () => {
  it("says so plainly and keeps the temporary-password path", async () => {
    const off = await setupTestApp(undefined, {}, { mailer: new MemoryMailer("off") });
    try {
      await createUser(off, "owner", "o2@example.test");
      const o = await login(off, "o2@example.test");
      const res = await off.app.inject({ method: "POST", url: "/api/users", headers: o.headers, payload: { email: "n@example.test", name: "N", role: "viewer", sendInvite: true } });
      expect(res.json().error.code).toBe("EMAIL_NOT_CONFIGURED");
      expect((await off.app.inject({ method: "GET", url: "/api/users", headers: o.headers })).json().emailMode).toBe("off");
      const temp = await off.app.inject({ method: "POST", url: "/api/users", headers: o.headers, payload: { email: "n@example.test", name: "N", role: "viewer", password: "temporary-pass-123" } });
      expect(temp.statusCode).toBe(201);
    } finally {
      await teardown(off);
    }
  });

  it("a failed send is reported, and the undelivered link is revoked", async () => {
    const failing = await setupTestApp(undefined, {}, { mailer: new MemoryMailer("smtp", true) });
    try {
      await createUser(failing, "owner", "o3@example.test");
      const o = await login(failing, "o3@example.test");
      const res = await failing.app.inject({ method: "POST", url: "/api/users", headers: o.headers, payload: { email: "f@example.test", name: "F", role: "viewer", sendInvite: true } });
      expect(res.statusCode).toBe(201);
      expect(res.json().invite).toMatchObject({ status: "failed", error: "connection refused" });
      const open = await failing.handle.db.select().from(schema.userTokens);
      expect(open.every((t) => t.revokedAt)).toBe(true);
    } finally {
      await teardown(failing);
    }
  });
});
