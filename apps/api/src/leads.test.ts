import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildWhatsappTextPayload, signWhatsappBody } from "@acc/agents";
import { eq, schema } from "@acc/database";
import { createUser, login, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;
let operator: Awaited<ReturnType<typeof login>>;
let viewer: Awaited<ReturnType<typeof login>>;
let admin: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  ctx = await setupTestApp(undefined, { WHATSAPP_APP_SECRET: "s", ACC_ENABLE_MOCKS: "true" });
  await createUser(ctx, "operator");
  await createUser(ctx, "viewer");
  await createUser(ctx, "admin");
  operator = await login(ctx, "operator@example.test");
  viewer = await login(ctx, "viewer@example.test");
  admin = await login(ctx, "admin@example.test");
});
afterAll(async () => ctx && teardown(ctx));

describe("leads API", () => {
  let leadId: string;

  it("creates a lead with a normalised phone (201)", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/api/leads", headers: operator.headers, payload: { phone: "0300 555 1234", name: "Sana", source: "facebook_ad", notes: "Teacher" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ duplicate: false, contact: { phone: "+923005551234", name: "Sana" }, lead: { source: "facebook_ad", score: 10, band: "cold" } });
    leadId = res.json().lead.id;
  });

  it("duplicate lead: same phone in another format merges into the open lead (200)", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/api/leads", headers: operator.headers, payload: { phone: "+92 300 5551234", source: "referral" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ duplicate: true, lead: { id: leadId } });
    const audits = await ctx.handle.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "lead.duplicate_merged"));
    expect(audits).toHaveLength(1);
  });

  it("invalid phone → 400; viewer cannot create → 403", async () => {
    expect((await ctx.app.inject({ method: "POST", url: "/api/leads", headers: operator.headers, payload: { phone: "12345" } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "POST", url: "/api/leads", headers: viewer.headers, payload: { phone: "03001234567" } })).statusCode).toBe(403);
  });

  it("PATCH: profile fit rescored, follow-up set, status won (humans may close)", async () => {
    const res = await ctx.app.inject({
      method: "PATCH", url: `/api/leads/${leadId}`, headers: operator.headers,
      payload: { profileFit: true, nextFollowUpAt: "2026-09-26T10:00:00+05:00", status: "qualified" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().lead).toMatchObject({ score: 20, status: "qualified" });
    const won = await ctx.app.inject({ method: "PATCH", url: `/api/leads/${leadId}`, headers: operator.headers, payload: { status: "won" } });
    expect(won.json().lead.status).toBe("won");
  });

  it("list: search, band filter, and due follow-ups", async () => {
    await ctx.app.inject({ method: "POST", url: "/api/leads", headers: operator.headers, payload: { phone: "03007778888", name: "Bilal", source: "whatsapp" } });
    const all = await ctx.app.inject({ method: "GET", url: "/api/leads", headers: viewer.headers });
    expect(all.json().total).toBe(2);
    const search = await ctx.app.inject({ method: "GET", url: "/api/leads?q=bil", headers: viewer.headers });
    expect(search.json().leads.map((l: { name: string }) => l.name)).toEqual(["Bilal"]);
    const byPhone = await ctx.app.inject({ method: "GET", url: "/api/leads?q=5551234", headers: viewer.headers });
    expect(byPhone.json().leads).toHaveLength(1);
    const hot = await ctx.app.inject({ method: "GET", url: "/api/leads?band=hot", headers: viewer.headers });
    expect(hot.json().leads).toHaveLength(0);
    expect((await ctx.app.inject({ method: "GET", url: "/api/leads?band=boiling", headers: viewer.headers })).statusCode).toBe(400);
  });

  it("delete is soft, admin-only, audited", async () => {
    expect((await ctx.app.inject({ method: "DELETE", url: `/api/leads/${leadId}`, headers: operator.headers })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "DELETE", url: `/api/leads/${leadId}`, headers: admin.headers })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: "GET", url: `/api/leads/${leadId}`, headers: viewer.headers })).statusCode).toBe(404);
    const [row] = await ctx.handle.db.select().from(schema.leads).where(eq(schema.leads.id, leadId));
    expect(row!.deletedAt).not.toBeNull();
  });

  it("scoring rules are exposed with their version", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/leads/scoring", headers: viewer.headers });
    expect(res.json()).toMatchObject({ version: "v1-starter", bands: { hot: 60, warm: 30 } });
  });
});

describe("conversations API", () => {
  it("lists conversations and shows the thread with lead band", async () => {
    const raw = JSON.stringify(buildWhatsappTextPayload({ from: "923331234567", name: "Hina", id: "wamid.c1", text: "Enroll karna hai, fee kitni hai?" }));
    await ctx.app.inject({ method: "POST", url: "/api/webhooks/whatsapp", headers: { "content-type": "application/json", "x-hub-signature-256": signWhatsappBody(raw, "s") }, payload: raw });

    const list = await ctx.app.inject({ method: "GET", url: "/api/conversations", headers: viewer.headers });
    const conv = list.json().conversations[0];
    expect(conv).toMatchObject({ contactName: "Hina", lastMessage: "Enroll karna hai, fee kitni hai?", lastDirection: "inbound", band: "warm", pendingDrafts: 0 });

    const detail = await ctx.app.inject({ method: "GET", url: `/api/conversations/${conv.id}`, headers: viewer.headers });
    expect(detail.json()).toMatchObject({ contact: { phone: "+923331234567" }, lead: { score: 45 }, drafts: [] });
    // Pending draft count is per conversation.
    const [task] = await ctx.handle.db.insert(schema.agentTasks).values({ title: "t", input: "t" }).returning();
    await ctx.handle.db.insert(schema.approvals).values({ taskId: task!.id, actionType: "external", toolName: "whatsapp.send", risk: "external", title: "Send", payload: { conversationId: conv.id, text: "hi" }, idempotencyKey: "pd-1" });
    const again = (await ctx.app.inject({ method: "GET", url: "/api/conversations", headers: viewer.headers })).json().conversations[0];
    expect(again.pendingDrafts).toBe(1);
    expect(detail.json().messages).toHaveLength(1);
  });

  it("manual triage creates a pre-planned WhatsApp task", async () => {
    const [conv] = await ctx.handle.db.select().from(schema.conversations);
    const res = await ctx.app.inject({ method: "POST", url: `/api/conversations/${conv!.id}/triage`, headers: operator.headers });
    expect(res.statusCode).toBe(202);
    const task = res.json().task;
    expect(task.plan).toMatchObject({ preset: true, skipReview: true, steps: [{ agent: "whatsapp" }] });
    expect(ctx.queue.jobs).toContain(task.id);
    expect((await ctx.app.inject({ method: "POST", url: `/api/conversations/${conv!.id}/triage`, headers: viewer.headers })).statusCode).toBe(403);
  });
});
