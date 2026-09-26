import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeAnalyticsTools, MetaAdsClient } from "@acc/agents";
import { eq, karachiDate, schema } from "@acc/database";
import { createUser, login, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof login>>;
let operator: Awaited<ReturnType<typeof login>>;
let viewer: Awaited<ReturnType<typeof login>>;

const adsCalls: string[] = [];
const fakeAds = (async (url: string | URL | Request) => {
  const u = String(url);
  adsCalls.push(u);
  if (u.includes("/insights")) {
    return new Response(JSON.stringify({
      data: [
        { campaign_id: "c1", campaign_name: "Batch 3 · Leads", spend: "12000.50", impressions: "40000", clicks: "800", actions: [{ action_type: "lead", value: "40" }, { action_type: "link_click", value: "800" }] },
        { campaign_id: "c2", campaign_name: "Awareness", spend: "3000", impressions: "90000", clicks: "300", actions: [] },
      ],
    }), { status: 200 });
  }
  return new Response(JSON.stringify({ name: "Aamir Ads", currency: "PKR" }), { status: 200 });
}) as typeof fetch;

beforeAll(async () => {
  ctx = await setupTestApp(undefined, {}, { ads: new MetaAdsClient({ accessToken: "t", adAccountId: "act_123", graphVersion: "v21.0" }, fakeAds) });
  for (const role of ["owner", "operator", "viewer"] as const) await createUser(ctx, role);
  owner = await login(ctx, "owner@example.test");
  operator = await login(ctx, "operator@example.test");
  viewer = await login(ctx, "viewer@example.test");
  // One verified payment today, so a snapshot has something real in it.
  await ctx.handle.db.insert(schema.payments).values({ amountMinor: 500_000, method: "bank_transfer", status: "verified", reference: "r1", paidAt: new Date() });
});
afterAll(async () => ctx && teardown(ctx));

const call = (s: { headers: Record<string, string> } | null, method: "GET" | "POST", url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: s?.headers ?? {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

describe("analytics API", () => {
  it("requires a session; every role can read", async () => {
    expect((await call(null, "GET", "/api/analytics")).statusCode).toBe(401);
    const res = await call(viewer, "GET", "/api/analytics?preset=last_7_days");
    expect(res.statusCode).toBe(200);
    expect(res.json().current.range).toMatchObject({ days: 7, to: karachiDate(new Date()), timezone: "Asia/Karachi" });
    expect(res.json().current.revenue.verifiedMinor).toBe(500_000);
    expect(res.json().previous.range.days).toBe(7);
  });

  it("validates ranges", async () => {
    expect((await call(viewer, "GET", "/api/analytics?from=2026-09-10&to=2026-09-01")).statusCode).toBe(400);
    expect((await call(viewer, "GET", "/api/analytics?preset=forever")).statusCode).toBe(400);
    expect((await call(viewer, "GET", "/api/analytics?from=2026-09-01&to=2026-09-07")).json().current.range.days).toBe(7);
  });

  it("today and insights respond", async () => {
    const today = (await call(viewer, "GET", "/api/analytics/today")).json();
    expect(today).toMatchObject({ counts: expect.any(Object), allClear: expect.any(Boolean) });
    expect((await call(viewer, "GET", "/api/analytics/insights?preset=last_30_days")).json()).toMatchObject({ insights: expect.any(Array) });
  });
});

describe("reports", () => {
  it("viewers can't create; a snapshot is computed by the server", async () => {
    expect((await call(viewer, "POST", "/api/reports", { period: "daily", preset: "today" })).statusCode).toBe(403);
    const res = await call(operator, "POST", "/api/reports", { period: "daily", preset: "today" });
    expect(res.statusCode).toBe(201);
    const r = res.json().report;
    expect(r).toMatchObject({ period: "daily", source: "user", narrative: null, title: expect.stringMatching(/^Daily report · /) });
    expect(r.metrics.revenue.verifiedMinor).toBe(500_000);
    expect(r.metrics.previous).toMatchObject({ revenueMinor: 0 });
    const list = (await call(viewer, "GET", "/api/reports")).json().reports;
    expect(list[0]).toMatchObject({ id: r.id, hasNarrative: false });
    expect((await call(viewer, "GET", `/api/reports/${r.id}`)).json().report.id).toBe(r.id);
  });

  it("asking the Analytics Agent queues a one-step task", async () => {
    const res = await call(owner, "POST", "/api/reports/agent", { preset: "last_week", period: "weekly" });
    expect(res.statusCode).toBe(202);
    expect(ctx.queue.jobs).toContain(res.json().task.id);
    expect(res.json().task.plan.steps[0]).toMatchObject({ agent: "analytics" });
  });

  it("an agent's report can only add a narrative: numbers are recomputed from the database", async () => {
    const save = makeAnalyticsTools(null).find((t) => t.name === "analytics.save_report")!;
    const [task] = await ctx.handle.db.insert(schema.agentTasks).values({ title: "t", input: "t" }).returning();
    const input = save.input.parse({ period: "daily", preset: "today", narrative: "Revenue was PKR 9,999,999 today, a record!", metrics: { revenue: { verifiedMinor: 999_999_900 } } });
    expect(input).not.toHaveProperty("metrics");
    const out = (await save.run(input, { db: ctx.handle.db, taskId: task!.id } as never)) as { reportId: string };
    const [row] = await ctx.handle.db.select().from(schema.analyticsReports).where(eq(schema.analyticsReports.id, out.reportId));
    expect(row).toMatchObject({ source: "agent", taskId: task!.id });
    expect((row!.metrics as { revenue: { verifiedMinor: number } }).revenue.verifiedMinor).toBe(500_000);
    expect(save.input.safeParse({ period: "daily", narrative: "x".repeat(30) }).success).toBe(false); // no range
  });
});

describe("ads (read-only)", () => {
  it("totals, cost per lead and the act_ prefix; campaigns:read required", async () => {
    const res = await call(viewer, "GET", "/api/ads?preset=last_30d");
    expect(res.json()).toMatchObject({
      status: "ok", currency: "PKR", accountName: "Aamir Ads", preset: "last_30d",
      totals: { spend: 15000.5, leads: 40, clicks: 1100, costPerLead: 375.01 },
    });
    expect(res.json().campaigns[0]).toMatchObject({ name: "Batch 3 · Leads", leads: 40, ctr: 2, costPerLead: 300.01 });
    expect(adsCalls.every((u) => u.includes("/act_123") && !u.includes("act_act_"))).toBe(true);
    expect(adsCalls.every((u) => !/\/(campaigns|adsets)\b.*POST/.test(u))).toBe(true);
  });

  it("not configured is explicit", async () => {
    const out = await new MetaAdsClient({ graphVersion: "v21.0" }).campaignInsights();
    expect(out).toEqual({ status: "not_configured", missing: ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"] });
  });
});
