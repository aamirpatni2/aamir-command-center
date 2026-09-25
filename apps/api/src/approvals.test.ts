import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WhatsAppClient } from "@acc/agents";
import { and, eq, schema } from "@acc/database";
import { createUser, login, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof login>>;
let admin: Awaited<ReturnType<typeof login>>;
let operator: Awaited<ReturnType<typeof login>>;
let viewer: Awaited<ReturnType<typeof login>>;

// Fake Meta Graph API. The client config object is shared, so tests can "unconfigure" WhatsApp.
const waCfg: { accessToken?: string; phoneNumberId?: string; graphVersion: string } = { accessToken: "test-token", phoneNumberId: "1234567890", graphVersion: "v21.0" };
let mode: "ok" | "reject" | "throw" | "server_error" = "ok";
const sent: { to: string; body: string }[] = [];
const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  const payload = JSON.parse(String(init?.body)) as { to: string; text: { body: string } };
  sent.push({ to: payload.to, body: payload.text.body });
  if (mode === "throw") throw new Error("socket hang up");
  if (mode === "reject") return new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), { status: 400 });
  if (mode === "server_error") return new Response("{}", { status: 503 });
  // A small delay makes the concurrency test meaningful.
  await new Promise((r) => setTimeout(r, 20));
  return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}.${Math.random().toString(36).slice(2)}` }] }), { status: 200 });
}) as typeof fetch;

beforeAll(async () => {
  ctx = await setupTestApp(undefined, {}, { whatsapp: new WhatsAppClient(waCfg, fakeFetch) });
  for (const role of ["owner", "admin", "operator", "viewer"] as const) await createUser(ctx, role);
  owner = await login(ctx, "owner@example.test");
  admin = await login(ctx, "admin@example.test");
  operator = await login(ctx, "operator@example.test");
  viewer = await login(ctx, "viewer@example.test");
});
afterAll(async () => ctx && teardown(ctx));
beforeEach(() => {
  mode = "ok";
  waCfg.accessToken = "test-token";
});

const call = (s: { headers: Record<string, string> } | null, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: s?.headers ?? {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

let seq = 0;
/** A lead wrote on WhatsApp `inboundAgoMs` ago; a triage task is waiting for approval of a reply draft. */
async function replyRequest(text = "Assalam o Alaikum! Next batch starts on 1 October.", opts: { inboundAgoMs?: number; risk?: "external" | "financial"; tool?: string; expiresAt?: Date } = {}) {
  const db = ctx.handle.db;
  seq += 1;
  const [contact] = await db.insert(schema.contacts).values({ name: `Lead ${seq}`, phone: `+92300${String(1_000_000 + seq)}` }).returning();
  const [conv] = await db.insert(schema.conversations).values({ contactId: contact!.id, channel: "whatsapp", externalThreadId: `t-${seq}` }).returning();
  await db.insert(schema.messages).values({
    conversationId: conv!.id, direction: "inbound", body: "Fee kitni hai?", status: "received", sentBy: "contact",
    providerMessageId: `wamid.in.${seq}`, createdAt: new Date(Date.now() - (opts.inboundAgoMs ?? 60_000)),
  });
  const [task] = await db.insert(schema.agentTasks).values({ title: `Triage ${seq}`, input: "triage", status: "WAITING_APPROVAL", source: "webhook" }).returning();
  const [approval] = await db
    .insert(schema.approvals)
    .values({
      taskId: task!.id, actionType: opts.risk ?? "external", toolName: opts.tool ?? "whatsapp.send", risk: opts.risk ?? "external",
      title: "Send WhatsApp reply", payload: { conversationId: conv!.id, text }, requestedByAgent: "whatsapp",
      idempotencyKey: `test-${seq}`, expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000),
    })
    .returning();
  return { approvalId: approval!.id, taskId: task!.id, conversationId: conv!.id, phone: contact!.phone! };
}

const approvalRow = async (id: string) => (await ctx.handle.db.select().from(schema.approvals).where(eq(schema.approvals.id, id)))[0]!;
const taskRow = async (id: string) => (await ctx.handle.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, id)))[0]!;
const auditActions = async (id: string) =>
  (await ctx.handle.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.entityType, "approval"), eq(schema.auditLogs.entityId, id)))).map((a) => a.action);

describe("authorization", () => {
  it("requires a session and CSRF token", async () => {
    const { approvalId } = await replyRequest();
    expect((await call(null, "GET", "/api/approvals")).statusCode).toBe(401);
    const noCsrf = await ctx.app.inject({ method: "POST", url: `/api/approvals/${approvalId}/approve`, headers: { cookie: owner.cookie }, payload: {} });
    expect(noCsrf.statusCode).toBe(403);
    expect((await approvalRow(approvalId)).status).toBe("pending");
  });

  it("viewers and operators can read but never decide, edit or execute", async () => {
    const { approvalId } = await replyRequest();
    const list = await call(viewer, "GET", "/api/approvals");
    expect(list.statusCode).toBe(200);
    expect(list.json().approvals.find((a: { id: string }) => a.id === approvalId).canDecide).toBe(false);
    for (const who of [viewer, operator]) {
      expect((await call(who, "POST", `/api/approvals/${approvalId}/approve`, {})).statusCode).toBe(403);
      expect((await call(who, "POST", `/api/approvals/${approvalId}/reject`, {})).statusCode).toBe(403);
      expect((await call(who, "PATCH", `/api/approvals/${approvalId}`, { edits: { text: "hacked" } })).statusCode).toBe(403);
      expect((await call(who, "POST", `/api/approvals/${approvalId}/execute`, {})).statusCode).toBe(403);
    }
    const row = await approvalRow(approvalId);
    expect(row).toMatchObject({ status: "pending", editedPayload: null });
    expect(sent).toHaveLength(0);
  });

  it("financial actions need the owner; unknown tools are never faked", async () => {
    const { approvalId } = await replyRequest("x", { risk: "financial", tool: "ads.budget.increase" });
    const denied = await call(admin, "POST", `/api/approvals/${approvalId}/approve`, {});
    expect(denied.statusCode).toBe(403);
    expect((await call(admin, "GET", `/api/approvals/${approvalId}`)).json().approval.canDecide).toBe(false);
    const ok = await call(owner, "POST", `/api/approvals/${approvalId}/approve`, {});
    expect(ok.statusCode).toBe(200);
    expect(ok.json().outcome).toMatchObject({ status: "not_executed", code: "NO_EXECUTOR" });
    expect(ok.json().approval.status).toBe("approved");
  });
});

describe("approve → execute exactly once", () => {
  it("sends the WhatsApp reply, records the message, audits, and completes the task", async () => {
    const before = sent.length;
    const r = await replyRequest();
    const res = await call(admin, "POST", `/api/approvals/${r.approvalId}/approve`, { note: "Looks good" });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome.status).toBe("executed");
    expect(res.json().approval).toMatchObject({ status: "executed", decisionNote: "Looks good", decidedBy: { name: "admin user" }, executionAttempts: 1 });
    expect(sent.length - before).toBe(1);
    expect(sent.at(-1)).toEqual({ to: r.phone.slice(1), body: "Assalam o Alaikum! Next batch starts on 1 October." });

    const out = await ctx.handle.db.select().from(schema.messages).where(and(eq(schema.messages.conversationId, r.conversationId), eq(schema.messages.direction, "outbound")));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "sent", sentBy: "agent", providerMessageId: res.json().approval.executionResult.providerMessageId });

    const task = await taskRow(r.taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.finishedAt).not.toBeNull();
    expect((task.result as { approvalOutcomes: { status: string }[] }).approvalOutcomes).toEqual([expect.objectContaining({ id: r.approvalId, status: "executed" })]);
    expect(await auditActions(r.approvalId)).toEqual(expect.arrayContaining(["approval.approve", "approval.executed"]));

    const again = await call(owner, "POST", `/api/approvals/${r.approvalId}/approve`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("ALREADY_DECIDED");
    expect((await call(owner, "POST", `/api/approvals/${r.approvalId}/execute`, {})).statusCode).toBe(409);
    expect(sent.length - before).toBe(1);
  });

  it("concurrent approvals send only once", async () => {
    const before = sent.length;
    const r = await replyRequest();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => call(i % 2 ? owner : admin, "POST", `/api/approvals/${r.approvalId}/approve`, {})));
    expect(results.filter((x) => x.statusCode === 200)).toHaveLength(1);
    expect(results.filter((x) => x.statusCode === 409)).toHaveLength(5);
    expect(sent.length - before).toBe(1);
    expect((await approvalRow(r.approvalId)).executionAttempts).toBe(1);
  });
});

describe("edit", () => {
  it("only the text can change; the original is kept; the edited text is what's sent", async () => {
    const r = await replyRequest("Draft reply");
    const retarget = await call(owner, "PATCH", `/api/approvals/${r.approvalId}`, { edits: { conversationId: "00000000-0000-4000-8000-000000000000" } });
    expect(retarget.statusCode).toBe(400);
    expect(retarget.json().error.code).toBe("INVALID_EDIT");
    expect((await call(owner, "PATCH", `/api/approvals/${r.approvalId}`, { edits: { text: "" } })).statusCode).toBe(400);

    const edited = await call(owner, "PATCH", `/api/approvals/${r.approvalId}`, { edits: { text: "Edited by Aamir" } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().approval).toMatchObject({ edited: true, payload: { text: "Edited by Aamir" }, originalPayload: { text: "Draft reply" }, status: "pending" });

    const res = await call(owner, "POST", `/api/approvals/${r.approvalId}/approve`, {});
    expect(res.json().outcome.status).toBe("executed");
    expect(sent.at(-1)!.body).toBe("Edited by Aamir");
    const [msg] = await ctx.handle.db.select().from(schema.messages).where(and(eq(schema.messages.conversationId, r.conversationId), eq(schema.messages.direction, "outbound")));
    expect(msg).toMatchObject({ body: "Edited by Aamir", sentBy: "user" });
    expect(await auditActions(r.approvalId)).toContain("approval.edit");
  });

  it("edits can be applied in the approve call itself", async () => {
    const r = await replyRequest("Draft");
    const res = await call(owner, "POST", `/api/approvals/${r.approvalId}/approve`, { edits: { text: "Final wording" } });
    expect(res.json().outcome.status).toBe("executed");
    expect(sent.at(-1)!.body).toBe("Final wording");
    expect((await approvalRow(r.approvalId)).payload).toMatchObject({ text: "Draft" });
  });

  it("decided requests can't be edited", async () => {
    const r = await replyRequest();
    await call(owner, "POST", `/api/approvals/${r.approvalId}/reject`, {});
    expect((await call(owner, "PATCH", `/api/approvals/${r.approvalId}`, { edits: { text: "late" } })).statusCode).toBe(409);
  });
});

describe("reject, expiry and cancellation", () => {
  it("reject records the decision, sends nothing and completes the task", async () => {
    const before = sent.length;
    const r = await replyRequest();
    const res = await call(owner, "POST", `/api/approvals/${r.approvalId}/reject`, { note: "Wrong fee" });
    expect(res.json().approval).toMatchObject({ status: "rejected", decisionNote: "Wrong fee" });
    expect(sent.length).toBe(before);
    expect((await taskRow(r.taskId)).status).toBe("COMPLETED");
    expect(await auditActions(r.approvalId)).toContain("approval.reject");
    expect((await call(owner, "POST", `/api/approvals/${r.approvalId}/approve`, {})).statusCode).toBe(409);
  });

  it("expired requests can't be approved", async () => {
    const r = await replyRequest("old", { expiresAt: new Date(Date.now() - 1000) });
    const res = await call(owner, "POST", `/api/approvals/${r.approvalId}/approve`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXPIRED");
    expect((await approvalRow(r.approvalId)).status).toBe("expired");
    expect((await taskRow(r.taskId)).status).toBe("COMPLETED");
  });

  it("cancelling a task expires its pending requests", async () => {
    const r = await replyRequest();
    expect((await call(owner, "POST", `/api/tasks/${r.taskId}/cancel`, {})).statusCode).toBe(200);
    expect(await approvalRow(r.approvalId)).toMatchObject({ status: "expired", decisionNote: "Task cancelled" });
  });
});

describe("execution outcomes", () => {
  it("outside the 24h window nothing is sent; the approval stays open and can be cancelled", async () => {
    const before = sent.length;
    const r = await replyRequest("Late reply", { inboundAgoMs: 25 * 3600_000 });
    const res = await call(owner, "POST", `/api/approvals/${r.approvalId}/approve`, {});
    expect(res.json().outcome).toMatchObject({ status: "not_executed", code: "OUTSIDE_WINDOW" });
    expect(res.json().approval).toMatchObject({ status: "approved", executionResult: { retryable: true, code: "OUTSIDE_WINDOW" } });
    expect(sent.length).toBe(before);
    expect((await taskRow(r.taskId)).status).toBe("WAITING_APPROVAL");
    const cancel = await call(owner, "POST", `/api/approvals/${r.approvalId}/reject`, { note: "Will call instead" });
    expect(cancel.json().approval.status).toBe("rejected");
    expect((await taskRow(r.taskId)).status).toBe("COMPLETED");
  });

  it("not configured → nothing sent, clear message, retry works once configured", async () => {
    waCfg.accessToken = undefined;
    const before = sent.length;
    const r = await replyRequest();
    const res = await call(owner, "POST", `/api/approvals/${r.approvalId}/approve`, {});
    expect(res.json().outcome).toMatchObject({ status: "not_executed", code: "NOT_CONFIGURED", details: { missing: ["WHATSAPP_ACCESS_TOKEN"] } });
    expect(res.json().outcome.message).toContain("WHATSAPP_ACCESS_TOKEN");
    expect(sent.length).toBe(before);

    waCfg.accessToken = "test-token";
    const retry = await call(owner, "POST", `/api/approvals/${r.approvalId}/execute`, {});
    expect(retry.json().outcome.status).toBe("executed");
    expect(retry.json().approval).toMatchObject({ status: "executed", executionAttempts: 2 });
    expect(sent.length - before).toBe(1);
    expect(await auditActions(r.approvalId)).toEqual(expect.arrayContaining(["approval.not_executed", "approval.executed"]));
  });

  it("a rejection from Meta (4xx) is retryable", async () => {
    mode = "reject";
    const r = await replyRequest();
    const res = await call(owner, "POST", `/api/approvals/${r.approvalId}/approve`, {});
    expect(res.json().outcome).toMatchObject({ status: "not_executed", code: "PROVIDER_REJECTED" });
    mode = "ok";
    expect((await call(owner, "POST", `/api/approvals/${r.approvalId}/execute`, {})).json().outcome.status).toBe("executed");
  });

  it.each(["throw", "server_error"] as const)("an unknown outcome (%s) is failed and never retried", async (m) => {
    mode = m;
    const before = sent.length;
    const r = await replyRequest();
    const res = await call(owner, "POST", `/api/approvals/${r.approvalId}/approve`, {});
    expect(res.json().outcome.status).toBe("unknown");
    expect(res.json().approval).toMatchObject({ status: "failed", executionResult: { retryable: false } });
    mode = "ok";
    const retry = await call(owner, "POST", `/api/approvals/${r.approvalId}/execute`, {});
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe("NOT_EXECUTABLE");
    expect(sent.length - before).toBe(1);
    expect((await taskRow(r.taskId)).status).toBe("COMPLETED");
  });

  it("student.message without a WhatsApp conversation and ineligible certificates are not executed", async () => {
    const db = ctx.handle.db;
    const [contact] = await db.insert(schema.contacts).values({ name: "Student S", phone: "+923339990001" }).returning();
    const [student] = await db.insert(schema.students).values({ contactId: contact!.id }).returning();
    const [course] = await db.insert(schema.courses).values({ slug: "c-approvals", title: "Course A", priceMinor: 100_000, status: "active" }).returning();
    const [batch] = await db.insert(schema.courseBatches).values({ courseId: course!.id, name: "Batch 1" }).returning();
    const [enrollment] = await db.insert(schema.enrollments).values({ studentId: student!.id, batchId: batch!.id, status: "active" }).returning();
    const [msg, cert] = await db
      .insert(schema.approvals)
      .values([
        { actionType: "external", toolName: "student.message", risk: "external", title: "Remind", payload: { studentId: student!.id, text: "Class at 8pm", purpose: "reminder" }, idempotencyKey: "s-msg" },
        { actionType: "external", toolName: "certificate.request", risk: "external", title: "Issue certificate", payload: { enrollmentId: enrollment!.id }, idempotencyKey: "s-cert" },
      ])
      .returning();

    const m = await call(owner, "POST", `/api/approvals/${msg!.id}/approve`, {});
    expect(m.json().outcome).toMatchObject({ status: "not_executed", code: "OUTSIDE_WINDOW" });
    const c = await call(owner, "POST", `/api/approvals/${cert!.id}/approve`, {});
    expect(c.json().outcome).toMatchObject({ status: "not_executed", code: "PRECONDITION" });
    expect(c.json().outcome.message).toContain("Fee fully paid");
    expect((await db.select().from(schema.enrollments).where(eq(schema.enrollments.id, enrollment!.id)))[0]!.certificateStatus).not.toBe("issued");

    const list = await call(viewer, "GET", "/api/approvals?status=open");
    const item = list.json().approvals.find((a: { id: string }) => a.id === cert!.id);
    expect(item.context).toMatchObject({ contactName: "Student S", course: "Course A · Batch 1" });
  });
});

describe("listing", () => {
  it("open list shows context (who, 24h window) and counts; decided list shows history", async () => {
    const r = await replyRequest("Context check");
    const open = await call(viewer, "GET", "/api/approvals?status=open");
    const item = open.json().approvals.find((a: { id: string }) => a.id === r.approvalId);
    expect(item).toMatchObject({ agent: "whatsapp", tool: "whatsapp.send", editableFields: ["text"], context: { conversationId: r.conversationId, lastInboundText: "Fee kitni hai?" } });
    expect(item.context.contactName).toMatch(/^Lead /);
    expect(new Date(item.context.lastInboundAt).getTime()).toBeGreaterThan(Date.now() - 3600_000);
    expect(open.json().counts.pending).toBeGreaterThanOrEqual(1);

    const decided = await call(viewer, "GET", "/api/approvals?status=decided");
    const statuses = new Set(decided.json().approvals.map((a: { status: string }) => a.status));
    for (const s of statuses) expect(["executed", "rejected", "expired", "failed"]).toContain(s);
    expect((await call(viewer, "GET", "/api/approvals?status=bogus")).statusCode).toBe(400);
  });
});

describe("task resumption", () => {
  it("a task still running when its approvals are decided completes when the run finishes", async () => {
    const { settleTask } = await import("@acc/agents");
    const r = await replyRequest();
    await ctx.handle.db.update(schema.agentTasks).set({ status: "RUNNING" }).where(eq(schema.agentTasks.id, r.taskId));
    await call(owner, "POST", `/api/approvals/${r.approvalId}/reject`, {});
    expect((await taskRow(r.taskId)).status).toBe("RUNNING");
    // What executeTask does when the run ends with WAITING_APPROVAL:
    await ctx.handle.db.update(schema.agentTasks).set({ status: "WAITING_APPROVAL" }).where(eq(schema.agentTasks.id, r.taskId));
    expect(await settleTask({ db: ctx.handle.db }, r.taskId)).toBe(true);
    expect((await taskRow(r.taskId)).status).toBe("COMPLETED");
  });
});
