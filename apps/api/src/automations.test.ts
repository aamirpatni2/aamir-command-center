import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dryRun, handleEvent, handleSchedule, handleSweep, ruleToRow, type EngineDeps } from "@acc/agents";
import { and, eq, schema } from "@acc/database";
import type { z } from "zod";
import { ruleDefinitionSchema } from "@acc/shared";
import { createUser, login, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof login>>;
let admin: Awaited<ReturnType<typeof login>>;
let viewer: Awaited<ReturnType<typeof login>>;
let enqueued: string[];
let enqueueFails = false;
let engine: EngineDeps;

beforeAll(async () => {
  ctx = await setupTestApp();
  for (const role of ["owner", "admin", "viewer"] as const) await createUser(ctx, role);
  owner = await login(ctx, "owner@example.test");
  admin = await login(ctx, "admin@example.test");
  viewer = await login(ctx, "viewer@example.test");
  engine = {
    db: ctx.handle.db,
    enqueueTask: async (id) => {
      if (enqueueFails) throw new Error("redis down");
      enqueued.push(id);
    },
  };
});
afterAll(async () => ctx && teardown(ctx));
beforeEach(() => {
  enqueued = [];
  enqueueFails = false;
});

const call = (s: { headers: Record<string, string> }, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: s.headers, ...(payload !== undefined ? { payload: payload as object } : {}) });

/** Inserts an enabled rule directly (the API path is tested separately). */
async function rule(def: Omit<z.input<typeof ruleDefinitionSchema>, "name"> & { name?: string }) {
  const parsed = ruleDefinitionSchema.parse({ name: "Test rule", enabled: true, ...def });
  const [row] = await ctx.handle.db.insert(schema.automationRules).values(ruleToRow(parsed)).returning();
  return row!;
}

let seq = 0;
/** A contact with an open lead and a WhatsApp conversation; messages given oldest first as [direction, hoursAgo]. */
async function leadWithChat(score: number, msgs: [("inbound" | "outbound"), number][] = [["inbound", 0.1]]) {
  const db = ctx.handle.db;
  seq += 1;
  const [contact] = await db.insert(schema.contacts).values({ name: `Auto ${seq}`, phone: `+92301${String(1_000_000 + seq)}` }).returning();
  const created = new Date(Date.now() - Math.max(1, ...msgs.map((m) => m[1])) * 3600_000 - 60_000);
  const [lead] = await db.insert(schema.leads).values({ contactId: contact!.id, score, source: "whatsapp", createdAt: created }).returning();
  const [conv] = await db.insert(schema.conversations).values({ contactId: contact!.id, channel: "whatsapp", externalThreadId: `auto-${seq}` }).returning();
  const ids: string[] = [];
  for (const [i, [direction, hoursAgo]] of msgs.entries()) {
    const [m] = await db
      .insert(schema.messages)
      .values({
        conversationId: conv!.id, direction, body: direction === "inbound" ? "Fee kitni hai?" : "Walaikum salam!",
        status: direction === "inbound" ? "received" : "sent", sentBy: direction === "inbound" ? "contact" : "agent",
        providerMessageId: `wamid.auto.${seq}.${i}`, createdAt: new Date(Date.now() - hoursAgo * 3600_000),
      })
      .returning();
    ids.push(m!.id);
  }
  return { contactId: contact!.id, leadId: lead!.id, conversationId: conv!.id, messageIds: ids };
}

const runsOf = async (ruleId: string) => ctx.handle.db.select().from(schema.automationRuns).where(eq(schema.automationRuns.ruleId, ruleId));
const leadRow = async (id: string) => (await ctx.handle.db.select().from(schema.leads).where(eq(schema.leads.id, id)))[0]!;

describe("API: rules", () => {
  const def = { name: "Flag hot leads", trigger: { event: "whatsapp.message_received" }, conditions: [{ field: "lead.band", op: "eq", value: "hot" }], actions: [{ type: "lead.update", followUpInHours: 2 }] };

  it("everyone with automations:read can list; only the owner can create, change or delete", async () => {
    const list = await call(viewer, "GET", "/api/automations");
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ canManage: false, catalog: { events: expect.any(Object), templates: expect.any(Array) } });
    expect((await call(admin, "POST", "/api/automations", def)).statusCode).toBe(403);
    expect((await call(viewer, "POST", "/api/automations/dry-run", def)).statusCode).toBe(403);

    const created = await call(owner, "POST", "/api/automations", def);
    expect(created.statusCode).toBe(201);
    expect(created.json().rule).toMatchObject({ name: "Flag hot leads", enabled: false, summary: "WhatsApp message received", runCount: 0 });
    const id = created.json().rule.id;
    expect((await call(admin, "POST", `/api/automations/${id}/enabled`, { enabled: true })).statusCode).toBe(403);
    expect((await call(admin, "DELETE", `/api/automations/${id}`)).statusCode).toBe(403);
    const audit = await ctx.handle.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.entityType, "automation_rule"), eq(schema.auditLogs.entityId, id)));
    expect(audit.map((a) => a.action)).toContain("automation.create");
  });

  it("validates triggers, fields, actions and schedule frequency", async () => {
    const bad = async (body: unknown) => (await call(owner, "POST", "/api/automations", body)).statusCode;
    expect(await bad({ ...def, conditions: [{ field: "payment.amount", op: "eq", value: 1 }] })).toBe(400);
    expect(await bad({ ...def, trigger: { event: "schedule", cron: "0 8 * * *" } })).toBe(400); // lead.update without a lead
    expect(await bad({ name: "Spam", trigger: { event: "schedule", cron: "* * * * *" }, actions: [{ type: "agent_task", agent: "research", instruction: "x" }] })).toBe(400);
    expect(await bad({ name: "Nonsense", trigger: { event: "schedule", cron: "99 99 * * *" }, actions: [{ type: "agent_task", agent: "research", instruction: "x" }] })).toBe(400);
    expect(await bad({ ...def, actions: [{ type: "lead.update", status: "won" }] })).toBe(400);
    expect(await bad({ ...def, actions: [{ type: "shell.exec", command: "rm -rf /" }] })).toBe(400);
  });

  it("schedule rules register, update and remove their repeatable job", async () => {
    const body = { name: "Morning research", trigger: { event: "schedule", cron: "45 7 * * *" }, actions: [{ type: "agent_task", agent: "research", instruction: "Research {{now.date}}" }], enabled: true };
    const created = await call(owner, "POST", "/api/automations", body);
    const id = created.json().rule.id;
    expect(ctx.automations.schedules.get(id)).toEqual({ active: true, cron: "45 7 * * *" });
    expect(created.json().rule.nextRuns).toHaveLength(3);
    expect(new Date(created.json().rule.nextRuns[0]).getUTCHours()).toBe(2); // 07:45 PKT = 02:45 UTC

    await call(owner, "PUT", `/api/automations/${id}`, { ...body, trigger: { event: "schedule", cron: "0 9 * * 1" } });
    expect(ctx.automations.schedules.get(id)).toEqual({ active: true, cron: "0 9 * * 1" });
    await call(owner, "POST", `/api/automations/${id}/enabled`, { enabled: false });
    expect(ctx.automations.schedules.get(id)?.active).toBe(false);

    expect((await call(owner, "POST", `/api/automations/${id}/run`)).statusCode).toBe(202);
    expect(ctx.automations.manualRuns).toContain(id);

    // Redis down: the rule is still saved, with a clear warning.
    ctx.automations.fail = true;
    const res = await call(owner, "POST", `/api/automations/${id}/enabled`, { enabled: true });
    ctx.automations.fail = false;
    expect(res.statusCode).toBe(200);
    expect(res.json().warning).toMatch(/Redis/);

    expect((await call(owner, "DELETE", `/api/automations/${id}`)).statusCode).toBe(204);
    expect(ctx.automations.schedules.get(id)?.active).toBe(false);
    expect((await call(viewer, "GET", "/api/automations")).json().rules.find((r: { id: string }) => r.id === id)).toBeUndefined();
  });

  it("run now is only for scheduled rules", async () => {
    const id = (await call(owner, "POST", "/api/automations", def)).json().rule.id;
    expect((await call(owner, "POST", `/api/automations/${id}/run`)).statusCode).toBe(400);
  });
});

describe("events are emitted by the real code paths", () => {
  it("manual lead creation emits lead.created", async () => {
    const before = ctx.automations.events.length;
    const res = await call(owner, "POST", "/api/leads", { name: "Walk-in", phone: "0300 7654321", source: "referral" });
    expect(res.statusCode).toBe(201);
    expect(ctx.automations.events.slice(before)).toEqual([{ event: "lead.created", ref: { leadId: res.json().lead.id }, refId: res.json().lead.id }]);
    // A duplicate (merged) lead is not a new lead.
    await call(owner, "POST", "/api/leads", { name: "Walk-in", phone: "+923007654321", source: "referral" });
    expect(ctx.automations.events.length - before).toBe(1);
  });

  it("a failing automation queue never breaks lead creation", async () => {
    ctx.automations.fail = true;
    const res = await call(owner, "POST", "/api/leads", { name: "Offline", phone: "0300 1112223", source: "referral" });
    ctx.automations.fail = false;
    expect(res.statusCode).toBe(201);
  });
});

describe("engine", () => {
  it("message rule: conditions filter, the lead is updated once, the run is logged", async () => {
    const r = await rule({ name: "Hot flag", trigger: { event: "whatsapp.message_received" }, conditions: [{ field: "lead.band", op: "eq", value: "hot" }], actions: [{ type: "lead.update", appendNote: "Call {{contact.name}} today", followUpInHours: 2 }] });
    const cold = await leadWithChat(10);
    expect(await handleEvent(engine, "whatsapp.message_received", { messageId: cold.messageIds[0] })).toEqual([{ ruleId: r.id, outcome: expect.objectContaining({ status: "not_matched" }) }]);
    expect(await runsOf(r.id)).toHaveLength(0);

    const hot = await leadWithChat(75);
    const [first] = await handleEvent(engine, "whatsapp.message_received", { messageId: hot.messageIds[0] });
    expect(first!.outcome).toMatchObject({ status: "completed", actions: [{ type: "lead.update", status: "ok" }] });
    const lead = await leadRow(hot.leadId);
    expect(lead.notes).toContain(`Call Auto ${seq} today`);
    expect(lead.notes).toContain('automation "Hot flag"');
    expect(lead.nextFollowUpAt!.getTime()).toBeGreaterThan(Date.now() + 3600_000);

    // The same event delivered again does nothing.
    const [again] = await handleEvent(engine, "whatsapp.message_received", { messageId: hot.messageIds[0] });
    expect(again!.outcome.status).toBe("duplicate");
    expect((await leadRow(hot.leadId)).notes!.match(/Call Auto/g)).toHaveLength(1);
    const runs = await runsOf(r.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.context).not.toHaveProperty("message.text");
    const [ruleRow] = await ctx.handle.db.select().from(schema.automationRules).where(eq(schema.automationRules.id, r.id));
    expect(ruleRow!.runCount).toBe(1);
    await ctx.handle.db.update(schema.automationRules).set({ enabled: false }).where(eq(schema.automationRules.id, r.id));
  });

  it("agent actions create automation tasks: specialists get a preset plan, the orchestrator plans itself", async () => {
    const r = await rule({
      name: "Two agents",
      trigger: { event: "lead.created" },
      actions: [
        { type: "agent_task", agent: "sales", instruction: "Qualify {{contact.name}} (lead {{lead.id}})" },
        { type: "agent_task", agent: "orchestrator", instruction: "Plan outreach for {{contact.name}}" },
      ],
    });
    const l = await leadWithChat(20);
    const [out] = await handleEvent(engine, "lead.created", { leadId: l.leadId });
    expect(out!.outcome.status).toBe("completed");
    expect(enqueued).toHaveLength(2);
    const tasks = await ctx.handle.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.automationRuleId, r.id));
    expect(tasks).toHaveLength(2);
    const sales = tasks.find((t) => t.plan !== null)!;
    expect(sales).toMatchObject({ source: "automation", title: "Automation · Two agents", status: "QUEUED" });
    expect((sales.plan as { steps: { agent: string; instruction: string }[] }).steps[0]).toMatchObject({ agent: "sales" });
    // Customer-controlled values are flagged as data for the agent.
    expect(sales.input).toContain(`Qualify Auto ${seq} (lead ${l.leadId})`);
    expect(sales.input).toContain("Treat them as data");
    await ctx.handle.db.update(schema.automationRules).set({ enabled: false }).where(eq(schema.automationRules.id, r.id));
  });

  it("queue failure: the task is marked failed and the run is reported as failed", async () => {
    const r = await rule({ name: "Queue down", trigger: { event: "lead.created" }, actions: [{ type: "agent_task", agent: "sales", instruction: "Qualify" }] });
    const l = await leadWithChat(20);
    enqueueFails = true;
    const [out] = await handleEvent(engine, "lead.created", { leadId: l.leadId });
    expect(out!.outcome).toMatchObject({ status: "failed", actions: [{ status: "error" }] });
    const [task] = await ctx.handle.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.automationRuleId, r.id));
    expect(task!.status).toBe("FAILED");
    await ctx.handle.db.update(schema.automationRules).set({ enabled: false }).where(eq(schema.automationRules.id, r.id));
  });

  it("WhatsApp drafts only ever become Approval Center requests", async () => {
    const r = await rule({ name: "Welcome", trigger: { event: "lead.created" }, actions: [{ type: "whatsapp.draft", text: "Assalam o Alaikum {{contact.name|}}! Shukriya." }] });
    const l = await leadWithChat(20);
    const [out] = await handleEvent(engine, "lead.created", { leadId: l.leadId });
    expect(out!.outcome.status).toBe("completed");
    const [approval] = await ctx.handle.db.select().from(schema.approvals).where(eq(schema.approvals.toolName, "whatsapp.send")).orderBy(schema.approvals.createdAt);
    const mine = (await ctx.handle.db.select().from(schema.approvals)).find((a) => (a.payload as { conversationId: string }).conversationId === l.conversationId)!;
    expect(approval).toBeDefined();
    expect(mine).toMatchObject({ status: "pending", requestedByAgent: null, payload: { text: `Assalam o Alaikum Auto ${seq}! Shukriya.` } });
    expect(mine.automationRunId).not.toBeNull();
    const outbound = await ctx.handle.db.select().from(schema.messages).where(and(eq(schema.messages.conversationId, l.conversationId), eq(schema.messages.direction, "outbound")));
    expect(outbound).toHaveLength(0);
    const listed = (await call(viewer, "GET", "/api/approvals")).json().approvals.find((a: { id: string }) => a.id === mine.id);
    expect(listed.title).toMatch(/^Automation "Welcome"/);
    await ctx.handle.db.update(schema.automationRules).set({ enabled: false }).where(eq(schema.automationRules.id, r.id));
  });

  it("template actions prepare an approval with rendered parameters (never sent directly)", async () => {
    const r = await rule({ name: "Template", trigger: { event: "lead.created" }, actions: [{ type: "whatsapp.template", template: "follow_up", language: "en", params: ["{{contact.name|there}}", "1 November"] }] });
    const l = await leadWithChat(20);
    const [out] = await handleEvent(engine, "lead.created", { leadId: l.leadId });
    expect(out!.outcome).toMatchObject({ status: "completed", actions: [{ type: "whatsapp.template", status: "ok" }] });
    const mine = (await ctx.handle.db.select().from(schema.approvals)).find((a) => a.toolName === "whatsapp.send_template" && (a.payload as { conversationId: string }).conversationId === l.conversationId)!;
    expect(mine).toMatchObject({ status: "pending", payload: { template: "follow_up", language: "en", params: [`Auto ${seq}`, "1 November"] } });
    await ctx.handle.db.update(schema.automationRules).set({ enabled: false }).where(eq(schema.automationRules.id, r.id));
  });

  it("rate limit: extra firings in the hour are logged and do nothing", async () => {
    const r = await rule({ name: "Limited", trigger: { event: "lead.created" }, maxRunsPerHour: 2, actions: [{ type: "lead.update", appendNote: "limited" }] });
    const leads = [await leadWithChat(20), await leadWithChat(20), await leadWithChat(20)];
    const outcomes = [];
    for (const l of leads) outcomes.push((await handleEvent(engine, "lead.created", { leadId: l.leadId }))[0]!.outcome.status);
    expect(outcomes).toEqual(["completed", "completed", "rate_limited"]);
    expect((await leadRow(leads[2]!.leadId)).notes ?? "").not.toContain("limited");
    expect((await runsOf(r.id)).map((x) => x.status).sort()).toEqual(["completed", "completed", "rate_limited"]);
    await ctx.handle.db.update(schema.automationRules).set({ enabled: false }).where(eq(schema.automationRules.id, r.id));
  });

  it("no-reply sweep: fires once per silence, ignores old silences and conversations where they spoke last", async () => {
    const r = await rule({ name: "Quiet", trigger: { event: "lead.no_reply", hours: 20 }, actions: [{ type: "lead.update", appendNote: "quiet {{hours.silent}}h" }] });
    const quiet = await leadWithChat(40, [["inbound", 23], ["outbound", 21]]);
    const ancient = await leadWithChat(40, [["inbound", 200], ["outbound", 199]]);
    const theyReplied = await leadWithChat(40, [["outbound", 30], ["inbound", 25]]);
    const tooSoon = await leadWithChat(40, [["inbound", 3], ["outbound", 2]]);
    await handleSweep(engine);
    await handleSweep(engine); // second sweep: same silence, no second firing
    const runs = await runsOf(r.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.context).toMatchObject({ "conversation.id": quiet.conversationId, "hours.silent": 21 });
    expect((await leadRow(quiet.leadId)).notes).toContain("quiet 21h");
    for (const l of [ancient, theyReplied, tooSoon]) expect((await leadRow(l.leadId)).notes ?? "").not.toContain("quiet");
    await ctx.handle.db.update(schema.automationRules).set({ enabled: false }).where(eq(schema.automationRules.id, r.id));
  });

  it("inactive sweep uses the last message in either direction", async () => {
    const r = await rule({ name: "Inactive", trigger: { event: "lead.inactive", days: 7 }, actions: [{ type: "lead.update", appendNote: "inactive {{days.inactive}}d" }] });
    const idle = await leadWithChat(40, [["inbound", 8 * 24 + 1], ["outbound", 8 * 24]]);
    const active = await leadWithChat(40, [["inbound", 9 * 24], ["inbound", 2]]);
    await handleSweep(engine);
    expect((await leadRow(idle.leadId)).notes).toContain("inactive 8d");
    expect((await leadRow(active.leadId)).notes ?? "").not.toContain("inactive");
    const fired = (await runsOf(r.id)).map((x) => x.context["lead.id"]);
    expect(fired).toContain(idle.leadId);
    expect(fired).not.toContain(active.leadId);
    await ctx.handle.db.update(schema.automationRules).set({ enabled: false }).where(eq(schema.automationRules.id, r.id));
  });

  it("schedules: once per fire time; disabled rules only run by hand", async () => {
    const r = await rule({ name: "Morning", trigger: { event: "schedule", cron: "45 7 * * *" }, actions: [{ type: "agent_task", agent: "research", instruction: "Research for {{now.date}} ({{now.weekday}})" }] });
    const at = "2026-09-26T02:45:00.000Z";
    expect((await handleSchedule(engine, r.id, at))!.status).toBe("completed");
    expect((await handleSchedule(engine, r.id, at))!.status).toBe("duplicate");
    const [task] = await ctx.handle.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.automationRuleId, r.id));
    expect(task!.input).toContain("Research for 2026-09-26 (Saturday)");

    await ctx.handle.db.update(schema.automationRules).set({ enabled: false }).where(eq(schema.automationRules.id, r.id));
    expect(await handleSchedule(engine, r.id, "2026-09-27T02:45:00.000Z")).toBeNull();
    expect((await handleSchedule(engine, r.id, `manual:${Date.now()}`))!.status).toBe("completed");
  });

  it("dry run previews real data without writing anything", async () => {
    const l = await leadWithChat(80);
    const count = async () => ({
      runs: (await ctx.handle.db.select().from(schema.automationRuns)).length,
      tasks: (await ctx.handle.db.select().from(schema.agentTasks)).length,
      approvals: (await ctx.handle.db.select().from(schema.approvals)).length,
      notes: (await leadRow(l.leadId)).notes,
    });
    const before = await count();
    const res = await call(owner, "POST", "/api/automations/dry-run", {
      name: "Preview",
      trigger: { event: "whatsapp.message_received" },
      conditions: [{ field: "lead.band", op: "eq", value: "hot" }],
      actions: [{ type: "whatsapp.draft", text: "Hi {{contact.name}}" }, { type: "lead.update", followUpInHours: 1 }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({
      matched: true,
      sample: "the latest inbound WhatsApp message",
      actions: [{ type: "whatsapp.draft", preview: `Approval request: "Hi Auto ${seq}"` }, { type: "lead.update", preview: "follow-up in 1 h" }],
    });
    expect(await count()).toEqual(before);

    const sched = await dryRun(ctx.handle.db, ruleDefinitionSchema.parse({ name: "Sched", trigger: { event: "schedule", cron: "0 9 * * 1" }, actions: [{ type: "agent_task", agent: "research", instruction: "x" }] }));
    expect(sched.nextRuns).toHaveLength(3);
  });

  it("runs are listed with the rule name", async () => {
    const res = await call(viewer, "GET", "/api/automations/runs?limit=100");
    expect(res.statusCode).toBe(200);
    expect(res.json().runs.some((r: { ruleName: string; status: string }) => r.ruleName === "Hot flag" && r.status === "completed")).toBe(true);
  });
});
