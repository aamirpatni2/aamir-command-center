import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema, type DbHandle } from "./index.js";
import { resetTestDatabase } from "./testing.js";
import { getAnalytics, getInsights, getToday, presetRange, previousRange, validateRange } from "./index.js";

// Fixture week: 1–7 September 2026, Pakistan time. Times are written with +05:00 on purpose.
const at = (s: string) => new Date(`2026-09-${s}+05:00`);
const RANGE = { from: "2026-09-01", to: "2026-09-07" };

let h: DbHandle;
beforeAll(async () => {
  h = createDb(await resetTestDatabase(), { max: 3 });
  const db = h.db;
  const [course] = await db.insert(schema.courses).values({ slug: "ai", title: "AI Course", priceMinor: 800_000, status: "active" }).returning();
  const [batch] = await db.insert(schema.courseBatches).values({ courseId: course!.id, name: "Batch 1" }).returning();
  const contact = async (phone: string, name: string) => (await db.insert(schema.contacts).values({ phone, name }).returning())[0]!;
  const s1 = (await db.insert(schema.students).values({ contactId: (await contact("+923000000101", "S One")).id }).returning())[0]!;
  const s2 = (await db.insert(schema.students).values({ contactId: (await contact("+923000000102", "S Two")).id }).returning())[0]!;
  const [e1] = await db.insert(schema.enrollments).values({ studentId: s1.id, batchId: batch!.id, status: "active", enrolledAt: at("02T09:00:00") }).returning();
  const [e2] = await db.insert(schema.enrollments).values({ studentId: s2.id, batchId: batch!.id, status: "active", enrolledAt: at("02T11:00:00") }).returning();

  await db.insert(schema.payments).values([
    { enrollmentId: e1!.id, amountMinor: 500_000, method: "bank_transfer", status: "verified", reference: "p1", paidAt: at("02T10:00:00") },
    // 23:30 on the last day, Pakistan time: inside the range.
    { enrollmentId: e2!.id, amountMinor: 300_000, method: "jazzcash", status: "verified", reference: "p2", paidAt: at("07T23:30:00") },
    // 00:30 on 8 September, Pakistan time (still 7 September in UTC): outside the range.
    { enrollmentId: e2!.id, amountMinor: 100_000, method: "jazzcash", status: "verified", reference: "p3", paidAt: at("08T00:30:00") },
    { enrollmentId: e2!.id, amountMinor: 200_000, method: "easypaisa", status: "pending", reference: "p4", paidAt: at("03T12:00:00") },
    { amountMinor: 50_000, method: "bank_transfer", status: "verified", reference: "p5", paidAt: at("04T12:00:00") },
  ]);

  const leadStatuses: [string, string][] = [["whatsapp", "new"], ["whatsapp", "contacted"], ["whatsapp", "qualified"], ["whatsapp", "won"], ["referral", "won"], ["referral", "lost"]];
  for (const [i, [source, status]] of leadStatuses.entries()) {
    const c = await contact(`+92300000020${i}`, `Lead ${i}`);
    await db.insert(schema.leads).values({ contactId: c.id, source, status: status as "new", score: i === 0 ? 70 : 20, createdAt: at(`0${2 + (i % 5)}T12:00:00`) });
  }
  const old = await contact("+923000000299", "Old lead");
  // 31 August: before the range.
  await db.insert(schema.leads).values({ contactId: old.id, source: "whatsapp", createdAt: new Date("2026-08-31T12:00:00+05:00") });

  const [c1] = await db.insert(schema.conversations).values({ contactId: old.id, channel: "whatsapp", externalThreadId: "a-1" }).returning();
  const c2c = await contact("+923000000301", "Chat Two");
  const [c2] = await db.insert(schema.conversations).values({ contactId: c2c.id, channel: "whatsapp", externalThreadId: "a-2" }).returning();
  const msg = (conversationId: string, direction: "inbound" | "outbound", time: string, id: string) =>
    ({ conversationId, direction, body: "x", status: direction === "inbound" ? ("received" as const) : ("sent" as const), sentBy: direction === "inbound" ? ("contact" as const) : ("agent" as const), providerMessageId: id, createdAt: at(time) });
  await db.insert(schema.messages).values([
    msg(c1!.id, "inbound", "03T10:00:00", "m1"),
    msg(c1!.id, "inbound", "03T10:05:00", "m2"), // same customer turn
    msg(c1!.id, "outbound", "03T10:30:00", "m3"), // 30 min
    msg(c2!.id, "inbound", "04T09:00:00", "m4"),
    msg(c2!.id, "outbound", "04T11:00:00", "m5"), // 120 min
    msg(c2!.id, "inbound", "05T12:00:00", "m6"), // never answered
  ]);

  await db.insert(schema.classes).values([
    { batchId: batch!.id, title: "Class 1", startsAt: at("05T20:00:00"), durationMin: 90, attendance: { [e1!.id]: "present", [e2!.id]: "absent" } },
    { batchId: batch!.id, title: "Class 2", startsAt: at("06T20:00:00"), durationMin: 90, attendance: { [e1!.id]: "late", [e2!.id]: "present" } },
  ]);

  const [task] = await db.insert(schema.agentTasks).values({ title: "t", input: "t" }).returning();
  await db.insert(schema.agentRuns).values([
    { taskId: task!.id, agentId: "research", status: "COMPLETED", latencyMs: 1000, inputTokens: 100, outputTokens: 50, costMicroUsd: 2000, createdAt: at("03T09:00:00") },
    { taskId: task!.id, agentId: "research", status: "COMPLETED", latencyMs: 3000, inputTokens: 200, outputTokens: 50, costMicroUsd: 3000, createdAt: at("03T09:10:00") },
    { taskId: task!.id, agentId: "research", status: "FAILED", createdAt: at("03T09:20:00") },
    { taskId: task!.id, agentId: "sales", status: "WAITING_APPROVAL", createdAt: at("04T09:00:00") },
  ]);

  const approval = (key: string, status: "executed" | "rejected" | "pending", created: string, decidedAfterMin?: number) => ({
    actionType: "external", toolName: "whatsapp.send", risk: "external" as const, title: "t", payload: {}, idempotencyKey: key, status,
    createdAt: at(created), ...(decidedAfterMin !== undefined ? { decidedAt: new Date(at(created).getTime() + decidedAfterMin * 60_000) } : {}),
  });
  await db.insert(schema.approvals).values([approval("a1", "executed", "04T10:00:00", 10), approval("a2", "rejected", "04T11:00:00", 30), approval("a3", "pending", "05T10:00:00")]);

  await db.insert(schema.contentItems).values([
    { type: "reel", title: "R1", body: "b", data: {}, status: "published", publishedAt: at("05T18:00:00"), createdAt: at("03T10:00:00") },
    { type: "reel", title: "R2", body: "b", data: {}, status: "draft", createdAt: at("04T10:00:00") },
  ]);
});
afterAll(async () => h?.close());

describe("analytics numbers match the fixture", () => {
  it("revenue: verified only, Pakistan calendar days, by course", async () => {
    const a = await getAnalytics(h.db, RANGE);
    expect(a.range).toMatchObject({ from: "2026-09-01", to: "2026-09-07", days: 7 });
    expect(a.revenue).toMatchObject({ verifiedMinor: 850_000, pendingMinor: 200_000, payments: 3 });
    expect(a.revenue.byDay).toHaveLength(7);
    expect(a.revenue.byDay.find((d) => d.day === "2026-09-07")!.minor).toBe(300_000);
    expect(a.revenue.byDay.find((d) => d.day === "2026-09-02")!.minor).toBe(500_000);
    expect(a.revenue.byCourse).toEqual([
      { course: "AI Course", minor: 800_000, payments: 2 },
      { course: "Not linked to a course", minor: 50_000, payments: 1 },
    ]);
  });

  it("leads: funnel, conversion and sources for leads created in the range", async () => {
    const a = await getAnalytics(h.db, RANGE);
    expect(a.leads).toMatchObject({ new: 6, won: 2, lost: 1, hotOpen: 1, conversionRate: 33.3 });
    expect(a.leads.funnel.map((f) => f.count)).toEqual([6, 5, 3, 2]);
    expect(a.leads.bySource).toEqual([
      { source: "whatsapp", leads: 4, won: 1, conversionRate: 25 },
      { source: "referral", leads: 2, won: 1, conversionRate: 50 },
    ]);
  });

  it("WhatsApp: one customer turn per burst; median reply over answered turns", async () => {
    const a = await getAnalytics(h.db, RANGE);
    expect(a.whatsapp).toEqual({ inbound: 4, outbound: 2, conversations: 2, customerTurns: 3, answered: 2, answeredRate: 66.7, medianReplyMinutes: 75, p90ReplyMinutes: 111 });
  });

  it("students, content, agents, approvals", async () => {
    const a = await getAnalytics(h.db, RANGE);
    expect(a.students).toEqual({ newEnrollments: 2, activeStudents: 2, classesHeld: 2, attendanceRate: 75 });
    expect(a.content).toEqual({ created: 2, published: 1, byType: [{ type: "reel", created: 2, published: 1 }] });
    expect(a.agents).toMatchObject({ runs: 4, completed: 2, failed: 1, successRate: 66.7, tokens: 400, costMicroUsd: 5000, mockRuns: 0 });
    expect(a.agents.byAgent.find((x) => x.agent === "research")).toMatchObject({ runs: 3, completed: 2, failed: 1, avgLatencyMs: 2000 });
    expect(a.approvals).toMatchObject({ requested: 3, pending: 1, executed: 1, rejected: 1, medianDecisionMinutes: 20 });
  });

  it("an empty range is all zeros, never invented", async () => {
    const a = await getAnalytics(h.db, { from: "2025-01-01", to: "2025-01-03" });
    expect(a.revenue.verifiedMinor).toBe(0);
    expect(a.leads.conversionRate).toBeNull();
    expect(a.whatsapp.medianReplyMinutes).toBeNull();
    expect(a.agents.successRate).toBeNull();
    expect(a.revenue.byDay.every((d) => d.minor === 0)).toBe(true);
  });
});

describe("ranges", () => {
  const now = new Date("2026-09-26T12:00:00+05:00"); // a Saturday
  it("presets are Pakistan calendar days; weeks start on Monday", () => {
    expect(presetRange("yesterday", now)).toEqual({ from: "2026-09-25", to: "2026-09-25" });
    expect(presetRange("last_7_days", now)).toEqual({ from: "2026-09-20", to: "2026-09-26" });
    expect(presetRange("last_week", now)).toEqual({ from: "2026-09-14", to: "2026-09-20" });
    expect(presetRange("last_month", now)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(presetRange("today", new Date("2026-09-26T23:30:00+05:00"))).toEqual({ from: "2026-09-26", to: "2026-09-26" });
    expect(previousRange(RANGE)).toEqual({ from: "2026-08-25", to: "2026-08-31" });
  });
  it("rejects bad ranges", () => {
    expect(() => validateRange({ from: "2026-09-08", to: "2026-09-01" })).toThrow();
    expect(() => validateRange({ from: "2024-01-01", to: "2026-01-01" })).toThrow();
    expect(() => validateRange({ from: "yesterday", to: "2026-01-01" })).toThrow();
  });
});

describe("today and insights", () => {
  it("lists only what needs a person, at a given moment", async () => {
    const t = await getToday(h.db, at("05T13:00:00"));
    // m6 (12:00, unanswered) waits; the conversation answered at 11:00 on the 4th doesn't.
    expect(t.waitingForReply.map((w) => w.lastMessage)).toEqual(["x"]);
    expect(t.counts).toMatchObject({ waitingForReply: 1, paymentsToVerify: 1 });
    expect(t.paymentsToVerify[0]).toMatchObject({ amountMinor: 200_000, method: "easypaisa", course: "AI Course" });
    expect(t.approvals).toMatchObject({ pending: 1 });
    expect(t.allClear).toBe(false);
  });

  it("insights appear only with enough data", async () => {
    const { insights } = await getInsights(h.db, RANGE, at("08T09:00:00"));
    const ids = insights.map((i) => i.id);
    expect(ids).toContain("pending-payments");
    expect(ids).toContain("approval-backlog");
    expect(ids).not.toContain("reply-speed"); // only 2 answered turns (< 5)
    expect(ids).not.toContain("best-source"); // < 10 leads
    expect(ids).not.toContain("revenue-change"); // nothing in the previous period to compare
  });
});
