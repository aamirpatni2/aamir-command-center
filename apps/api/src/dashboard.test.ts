import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@acc/database";
import { createUser, login, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;
let viewer: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  ctx = await setupTestApp();
  await createUser(ctx, "viewer");
  viewer = await login(ctx, "viewer@example.test");
});
afterAll(async () => teardown(ctx));

describe("GET /api/dashboard/summary", () => {
  it("requires auth", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/dashboard/summary" })).statusCode).toBe(401);
  });

  it("returns zeros on an empty database (no invented numbers)", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/dashboard/summary", headers: viewer.headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.timezone).toBe("Asia/Karachi");
    expect(Object.values(body.counts).every((v) => v === 0)).toBe(true);
    expect(body.revenueThisMonth).toEqual({ amountMinor: 0, currency: "PKR" });
    expect(body.recentRuns).toEqual([]);
    // Charts: a full 14-day axis of zeros, never sample data.
    expect(body.charts.activity).toHaveLength(14);
    expect(body.charts.activity.every((d: { leads: number; inbound: number; runs: number }) => d.leads + d.inbound + d.runs === 0)).toBe(true);
    expect(body.charts.activity.at(-1).day).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date()));
    expect(body.charts.leadBands).toEqual({ hot: 0, warm: 0, cold: 0 });
    expect(body.charts.leadSources).toEqual([]);
    expect(Object.values(body.charts.approvals30d).every((v) => v === 0)).toBe(true);
  });

  it("counts real records: leads, follow-ups, students, verified revenue only, approvals, tasks", async () => {
    const db = ctx.handle.db;
    const [c1] = await db.insert(schema.contacts).values({ phone: "+923000000001" }).returning();
    const [c2] = await db.insert(schema.contacts).values({ phone: "+923000000002" }).returning();
    const [c3] = await db.insert(schema.contacts).values({ phone: "+923000000003" }).returning();
    await db.insert(schema.leads).values({ contactId: c1!.id, score: 72, source: "whatsapp", nextFollowUpAt: new Date(Date.now() - 3600_000) });
    await db.insert(schema.leads).values({ contactId: c2!.id, status: "won", nextFollowUpAt: new Date(Date.now() - 3600_000) });
    const [c4] = await db.insert(schema.contacts).values({ phone: "+923000000004" }).returning();
    // Created 3 days ago (Pakistan time): lands in an earlier bucket, not "today".
    await db.insert(schema.leads).values({ contactId: c4!.id, score: 35, source: "facebook", createdAt: new Date(Date.now() - 3 * 86_400_000) });
    const [conv] = await db.insert(schema.conversations).values({ contactId: c1!.id, channel: "whatsapp", externalThreadId: "dash-1" }).returning();
    await db.insert(schema.messages).values([
      { conversationId: conv!.id, direction: "inbound", body: "a", status: "received", sentBy: "contact", providerMessageId: "d1" },
      { conversationId: conv!.id, direction: "inbound", body: "b", status: "received", sentBy: "contact", providerMessageId: "d2" },
      { conversationId: conv!.id, direction: "outbound", body: "c", status: "sent", sentBy: "agent", providerMessageId: "d3" },
    ]);
    await db.insert(schema.students).values({ contactId: c3!.id });
    await db.insert(schema.payments).values([
      { amountMinor: 500_000, method: "bank_transfer", status: "verified", reference: "r1", paidAt: new Date() },
      { amountMinor: 800_000, method: "jazzcash", status: "pending", reference: "r2", paidAt: new Date() },
    ]);
    const [task] = await db.insert(schema.agentTasks).values({ title: "Draft reels", input: "x", status: "WAITING_APPROVAL" }).returning();
    await db.insert(schema.agentRuns).values({ taskId: task!.id, agentId: "content", status: "RUNNING" });
    await db.insert(schema.approvals).values({
      taskId: task!.id, actionType: "publish", toolName: "content.publish", risk: "external",
      title: "Publish reel", payload: {}, idempotencyKey: "k1",
    });

    const body = (await ctx.app.inject({ method: "GET", url: "/api/dashboard/summary", headers: viewer.headers })).json();
    expect(body.counts).toEqual({
      tasksOpen: 1, newLeadsToday: 2, pendingFollowUps: 1, activeStudents: 1,
      activeAgents: 1, agentRunsToday: 1, pendingApprovals: 1,
    });
    expect(body.revenueThisMonth.amountMinor).toBe(500_000);
    expect(body.pendingApprovalItems[0]).toMatchObject({ title: "Publish reel", risk: "external" });
    expect(body.openTasks[0]).toMatchObject({ title: "Draft reels", status: "WAITING_APPROVAL" });
    expect(body.recentRuns[0]).toMatchObject({ agentId: "content", status: "RUNNING" });

    const days = body.charts.activity as { day: string; leads: number; inbound: number; runs: number }[];
    expect(days.at(-1)).toMatchObject({ leads: 2, inbound: 2, runs: 1 });
    expect(days.at(-4)!.leads).toBe(1);
    expect(days.reduce((t, d) => t + d.leads, 0)).toBe(3);
    // Open leads only (the won lead is excluded): one hot (72), one warm (35).
    expect(body.charts.leadBands).toEqual({ hot: 1, warm: 1, cold: 0 });
    expect(body.charts.leadSources).toEqual([{ source: "facebook", count: 1 }, { source: "whatsapp", count: 1 }]);
    expect(body.charts.approvals30d.pending).toBe(1);
  });
});
