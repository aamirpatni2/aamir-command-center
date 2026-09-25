import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema } from "@acc/database";
import { createUser, login, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof login>>;
let operator: Awaited<ReturnType<typeof login>>;
let viewer: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  ctx = await setupTestApp();
  await createUser(ctx, "owner");
  await createUser(ctx, "operator");
  await createUser(ctx, "viewer");
  owner = await login(ctx, "owner@example.test");
  operator = await login(ctx, "operator@example.test");
  viewer = await login(ctx, "viewer@example.test");
});
afterAll(async () => ctx && teardown(ctx));

const call = (s: { headers: Record<string, string> }, method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: s.headers, ...(payload !== undefined ? { payload: payload as object } : {}) });

describe("student journey: course → batch → enrol → pay → verify → classes → certificate", () => {
  let courseId: string, batchId: string, enrollmentId: string, studentId: string, paymentId: string;

  it("only owner/admin manage courses; slug is unique", async () => {
    const body = { slug: "practical-ai", title: "Complete Practical AI Training", priceMinor: 800_000, status: "active" };
    expect((await call(operator, "POST", "/api/courses", body)).statusCode).toBe(403);
    const res = await call(owner, "POST", "/api/courses", body);
    expect(res.statusCode).toBe(201);
    courseId = res.json().course.id;
    expect((await call(owner, "POST", "/api/courses", body)).statusCode).toBe(409);
  });

  it("creates a batch with an early-bird offer; validates dates and early-bird pairs", async () => {
    expect((await call(owner, "POST", `/api/courses/${courseId}/batches`, { name: "Bad", startsOn: "2026-09-10", endsOn: "2026-09-01" })).statusCode).toBe(400);
    expect((await call(owner, "POST", `/api/courses/${courseId}/batches`, { name: "Bad", earlyBirdPriceMinor: 500_000 })).statusCode).toBe(400);
    const res = await call(owner, "POST", `/api/courses/${courseId}/batches`, {
      name: "Batch 3", startsOn: "2026-10-01", capacity: 2, status: "enrolling", earlyBirdPriceMinor: 500_000, earlyBirdUntil: "2999-12-31",
      schedule: [{ day: "Sat", time: "20:00" }, { day: "Sun", time: "20:00" }],
    });
    expect(res.statusCode).toBe(201);
    batchId = res.json().batch.id;
    const courses = (await call(viewer, "GET", "/api/courses")).json().courses;
    expect(courses[0].batches[0]).toMatchObject({ currentPriceMinor: 500_000, earlyBirdActive: true, seatsLeft: 2 });
  });

  it("enrols a WhatsApp lead: student created, lead → negotiating; re-enrol → 409", async () => {
    const [c] = await ctx.handle.db.insert(schema.contacts).values({ phone: "+923001234567", name: "Ayesha" }).returning();
    await ctx.handle.db.insert(schema.leads).values({ contactId: c!.id, source: "whatsapp" });
    const res = await call(operator, "POST", "/api/enrollments", { batchId, phone: "0300-1234567" });
    expect(res.statusCode).toBe(201);
    ({ enrollment: { id: enrollmentId }, student: { id: studentId } } = res.json());
    expect(res.json().enrollment.status).toBe("pending");
    const [lead] = await ctx.handle.db.select().from(schema.leads);
    expect(lead!.status).toBe("negotiating");
    expect((await call(operator, "POST", "/api/enrollments", { batchId, phone: "+92 300 1234567" })).statusCode).toBe(409);
    expect((await call(viewer, "POST", "/api/enrollments", { batchId, phone: "03009999999" })).statusCode).toBe(403);
  });

  it("capacity is enforced", async () => {
    expect((await call(operator, "POST", "/api/enrollments", { batchId, phone: "03001111111", name: "B" })).statusCode).toBe(201);
    const full = await call(operator, "POST", "/api/enrollments", { batchId, phone: "03002222222", name: "C" });
    expect(full.statusCode).toBe(409);
    expect(full.json().error.message).toContain("full");
  });

  it("payments: recorded as pending; duplicate reference → 409; only owner/admin verify", async () => {
    const res = await call(operator, "POST", `/api/enrollments/${enrollmentId}/payments`, { amountMinor: 500_000, method: "jazzcash", reference: "JC-123" });
    expect(res.statusCode).toBe(201);
    paymentId = res.json().payment.id;
    expect(res.json().payment.status).toBe("pending");
    expect((await call(operator, "POST", `/api/enrollments/${enrollmentId}/payments`, { amountMinor: 500_000, method: "jazzcash", reference: "JC-123" })).statusCode).toBe(409);
    expect((await call(operator, "POST", `/api/payments/${paymentId}/verify`)).statusCode).toBe(403);
  });

  it("verifying payment activates the enrollment and marks the lead won; verify twice → 409", async () => {
    const res = await call(owner, "POST", `/api/payments/${paymentId}/verify`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ activated: true, payment: { status: "verified" } });
    const [lead] = await ctx.handle.db.select().from(schema.leads);
    expect(lead!.status).toBe("won");
    expect((await call(owner, "POST", `/api/payments/${paymentId}/verify`)).statusCode).toBe(409);
    const audits = await ctx.handle.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "payment.verify"));
    expect(audits).toHaveLength(1);
  });

  it("classes + attendance (rejects students from other batches) + assignments", async () => {
    const past = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    const c1 = (await call(operator, "POST", `/api/batches/${batchId}/classes`, { title: "Intro to AI", startsAt: past(7) })).json().class.id;
    const c2 = (await call(operator, "POST", `/api/batches/${batchId}/classes`, { title: "Prompting", startsAt: past(3) })).json().class.id;
    await call(operator, "POST", `/api/batches/${batchId}/classes`, { title: "Agents", startsAt: new Date(Date.now() + 86_400_000).toISOString() });

    expect((await call(operator, "PUT", `/api/classes/${c1}/attendance`, { attendance: { [enrollmentId]: "present" } })).statusCode).toBe(200);
    expect((await call(operator, "PUT", `/api/classes/${c2}/attendance`, { attendance: { [enrollmentId]: "late" } })).statusCode).toBe(200);
    const bad = await call(operator, "PUT", `/api/classes/${c1}/attendance`, { attendance: { "00000000-0000-0000-0000-000000000000": "present" } });
    expect(bad.statusCode).toBe(400);

    const a = (await call(operator, "POST", `/api/batches/${batchId}/assignments`, { title: "Build a GPT", maxScore: 10 })).json().assignment.id;
    const sub = await call(operator, "PUT", `/api/assignments/${a}/submissions/${enrollmentId}`, { status: "graded", score: 9, feedback: "Great" });
    expect(sub.json().submission).toMatchObject({ status: "graded", score: 9 });

    const recording = await call(operator, "PATCH", `/api/classes/${c1}`, { recordingUrl: "https://drive.example/rec1", recordingStatus: "available" });
    expect(recording.json().class.recordingStatus).toBe("available");
  });

  it("student detail shows progress, payments and certificate checks", async () => {
    const res = await call(viewer, "GET", `/api/students/${studentId}`);
    expect(res.statusCode).toBe(200);
    const e = res.json().enrollments[0];
    expect(e.progress).toMatchObject({
      status: "active", classesHeld: 2, classesAttended: 2, attendancePct: 100, assignmentsTotal: 1, assignmentsSubmitted: 1,
      priceMinor: 500_000, paidVerifiedMinor: 500_000, balanceMinor: 0,
    });
    expect(e.progress.certificate.eligible).toBe(true);
    expect(e.payments).toHaveLength(1);
    expect(res.json().lead.status).toBe("won");
  });

  it("certificate: owner-only, blocked when not eligible, issued once", async () => {
    const other = (await ctx.handle.db.select().from(schema.enrollments)).find((x) => x.id !== enrollmentId)!;
    const notEligible = await call(owner, "POST", `/api/enrollments/${other.id}/certificate`, {});
    expect(notEligible.statusCode).toBe(409);
    expect(notEligible.json().error.code).toBe("NOT_ELIGIBLE");
    expect(notEligible.json().error.details.map((d: { rule: string }) => d.rule)).toContain("Fee fully paid (verified)");

    expect((await call(operator, "POST", `/api/enrollments/${enrollmentId}/certificate`, {})).statusCode).toBe(403);
    const ok = await call(owner, "POST", `/api/enrollments/${enrollmentId}/certificate`, {});
    expect(ok.json().enrollment).toMatchObject({ certificateStatus: "issued", status: "completed" });
    expect((await call(owner, "POST", `/api/enrollments/${enrollmentId}/certificate`, {})).statusCode).toBe(409);
  });

  it("student list and batch roster include progress", async () => {
    const list = await call(viewer, "GET", `/api/students?batchId=${batchId}`);
    expect(list.json().students).toHaveLength(2);
    const roster = await call(viewer, "GET", `/api/batches/${batchId}`);
    expect(roster.json()).toMatchObject({ course: { slug: "practical-ai" }, classes: expect.any(Array), assignments: [expect.objectContaining({ title: "Build a GPT" })] });
    expect(roster.json().roster.find((r: { name: string }) => r.name === "Ayesha").progress.certificateStatus).toBe("issued");
  });
});
