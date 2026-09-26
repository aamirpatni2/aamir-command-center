import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";
import { createDb, eq, schema, type DbHandle } from "@acc/database";
import { resetTestDatabase } from "@acc/database/testing";
import { createDefaultToolRegistry, MemoryEventSink, MockProvider, ruleToRow, TRIAGE_JOB, type ExecuteTaskDeps } from "@acc/agents";
import { ruleDefinitionSchema } from "@acc/shared";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beat, markCrashed, processAutomationJob, processTaskJob, syncSchedules } from "./jobs.js";

const logger = pino({ level: "silent" });
let h: DbHandle;
let deps: ExecuteTaskDeps;

beforeAll(async () => {
  h = createDb(await resetTestDatabase(), { max: 3 });
  deps = { db: h.db, tools: createDefaultToolRegistry(), events: new MemoryEventSink(), logger, resolve: () => ({ provider: new MockProvider(), model: "mock" }) };
});
afterAll(async () => h?.close());

async function conversation() {
  const [c] = await h.db.insert(schema.contacts).values({ name: "Job test", phone: `+92300${Math.floor(1_000_000 + Math.random() * 8_999_999)}` }).returning();
  const [conv] = await h.db.insert(schema.conversations).values({ contactId: c!.id, channel: "whatsapp", externalThreadId: `job-${c!.id}` }).returning();
  await h.db.insert(schema.messages).values({ conversationId: conv!.id, direction: "inbound", body: "Salam, fee?", status: "received", sentBy: "contact" });
  return conv!.id;
}

describe("task jobs", () => {
  it("runs a queued task on the mock model", async () => {
    const [task] = await h.db.insert(schema.agentTasks).values({ title: "Q", input: "What courses do we offer?" }).returning();
    const out = await processTaskJob(deps, { id: "j1", name: "execute", data: { taskId: task!.id } });
    expect(out.status).toMatch(/COMPLETED|WAITING_APPROVAL/);
  });

  it("skips jobs without a task or with an unknown conversation", async () => {
    expect(await processTaskJob(deps, { name: "execute", data: {} })).toMatchObject({ status: "skipped" });
    expect(await processTaskJob(deps, { name: TRIAGE_JOB, data: { conversationId: "00000000-0000-4000-8000-000000000000" } })).toMatchObject({ status: "skipped" });
  });

  it("a crashing triage run never leaves its task stuck in RUNNING (regression)", async () => {
    const conv = await conversation();
    const boom: ExecuteTaskDeps = { ...deps, events: { publish: async () => { throw new Error("redis went away"); } } };
    await expect(processTaskJob(boom, { name: TRIAGE_JOB, data: { conversationId: conv } })).rejects.toThrow("redis went away");
    const [task] = await h.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.title, "WhatsApp triage · Job test"));
    expect(task).toMatchObject({ status: "FAILED", error: expect.stringMatching(/crashed/) });
    expect(task!.finishedAt).not.toBeNull();
  });

  it("markCrashed never overwrites a finished task", async () => {
    const [done] = await h.db.insert(schema.agentTasks).values({ title: "Done", input: "x", status: "COMPLETED", finishedAt: new Date() }).returning();
    expect(await markCrashed(h.db, done!.id)).toBe(false);
    expect((await h.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, done!.id)))[0]!.status).toBe("COMPLETED");
  });
});

describe("automation jobs", () => {
  const enqueued: string[] = [];
  const engine = () => ({ db: h.db, enqueueTask: async (id: string) => void enqueued.push(id) });

  it("dispatches events, schedules, sweeps and ignores unknown kinds", async () => {
    const def = ruleDefinitionSchema.parse({ name: "Sched", enabled: true, trigger: { event: "schedule", cron: "45 7 * * *" }, actions: [{ type: "agent_task", agent: "research", instruction: "Research {{now.date}}" }] });
    const [rule] = await h.db.insert(schema.automationRules).values(ruleToRow(def)).returning();

    expect(await processAutomationJob(engine(), { name: "event", data: { kind: "event", event: "lead.created", ref: { leadId: "00000000-0000-4000-8000-000000000000" } } }, logger)).toMatchObject({ rules: 0 });
    const sched = await processAutomationJob(engine(), { name: "schedule", timestamp: Date.parse("2026-09-26T02:45:00Z"), opts: {}, data: { kind: "schedule", ruleId: rule!.id } }, logger);
    expect(sched).toEqual({ status: "completed" });
    expect(enqueued).toHaveLength(1);
    // The same scheduler firing delivered twice runs once.
    expect(await processAutomationJob(engine(), { name: "schedule", timestamp: Date.parse("2026-09-26T02:45:00Z"), data: { kind: "schedule", ruleId: rule!.id } }, logger)).toEqual({ status: "duplicate" });
    expect(await processAutomationJob(engine(), { name: "sweep", data: { kind: "sweep" } }, logger)).toMatchObject({ rules: 0 });
    expect(await processAutomationJob(engine(), { name: "x", data: { kind: "bogus" as never } }, logger)).toEqual({ status: "ignored" });
  });

  it("schedule sync: DB is the source of truth; stale schedulers are removed; the sweep is ensured", async () => {
    const synced: { id: string; active: boolean }[] = [];
    const upserts: string[] = [];
    const removed: string[] = [];
    const fake = {
      syncSchedule: async (r: { id: string; active: boolean }) => void synced.push(r),
      queue: {
        getJobSchedulers: async () => [{ key: "rule:deleted-rule" }, { key: "sweep" }],
        removeJobScheduler: async (k: string) => void removed.push(k),
        upsertJobScheduler: async (k: string) => void upserts.push(k),
      },
    };
    const off = ruleDefinitionSchema.parse({ name: "Off", enabled: false, trigger: { event: "schedule", cron: "0 9 * * 1" }, actions: [{ type: "agent_task", agent: "analytics", instruction: "x" }] });
    await h.db.insert(schema.automationRules).values(ruleToRow(off));
    const out = await syncSchedules(h.db, fake as never);
    expect(out).toEqual({ schedules: 1, removed: ["rule:deleted-rule"] });
    expect(synced.map((s) => s.active).sort()).toEqual([false, true]);
    expect(upserts).toEqual(["sweep"]);
  });
});

describe("heartbeat", () => {
  it("is written only when Redis and Postgres both answer", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "acc-hb-")), "hb");
    expect(await beat(h.db, async () => { throw new Error("redis down"); }, file)).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(await beat(h.db, async () => "PONG", file)).toBe(true);
    expect(Date.now() - Number(readFileSync(file, "utf8"))).toBeLessThan(5_000);
  });
});
