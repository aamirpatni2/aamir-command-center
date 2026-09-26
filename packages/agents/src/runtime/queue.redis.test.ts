import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createAutomationQueue, createTaskQueue } from "./queue.js";

// Real Redis, isolated under a random key prefix so a running dev worker never sees these jobs.
const REDIS = process.env.REDIS_URL ?? "redis://localhost:6379";
const prefix = `acc-test-${randomUUID().slice(0, 8)}`;
const tasks = createTaskQueue(REDIS, { prefix });
const autos = createAutomationQueue(REDIS, { prefix });

afterAll(async () => {
  await tasks.queue.obliterate({ force: true });
  await autos.queue.obliterate({ force: true });
  await tasks.close();
  await autos.close();
});

describe("task queue", () => {
  it("enqueuing the same task twice creates one job; no automatic retries", async () => {
    const id = randomUUID();
    await tasks.enqueue(id);
    await tasks.enqueue(id);
    const job = await tasks.queue.getJob(id);
    expect(job?.data).toEqual({ taskId: id });
    expect(job?.opts.attempts).toBe(1);
    expect(await tasks.queue.getJobCountByTypes("waiting")).toBe(1);
  });

  it("triage for one conversation is debounced into a single delayed job", async () => {
    const conv = randomUUID();
    await tasks.enqueueTriage(conv, 30_000);
    await tasks.enqueueTriage(conv, 30_000);
    const delayed = await tasks.queue.getJobs(["delayed"]);
    const mine = delayed.filter((j) => j.data.conversationId === conv);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.opts.delay).toBe(30_000);
  });
});

describe("automation queue", () => {
  it("the same event is queued once, with a BullMQ-safe job id", async () => {
    const ref = randomUUID();
    await autos.emit("whatsapp.message_received", { messageId: ref }, ref);
    await autos.emit("whatsapp.message_received", { messageId: ref }, ref);
    const jobs = (await autos.queue.getJobs(["waiting"])).filter((j) => j.data.ref?.messageId === ref);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).not.toContain(":");
    expect(jobs[0]!.data).toMatchObject({ kind: "event", event: "whatsapp.message_received" });
  });

  it("schedules are upserted in Pakistan time and removed when switched off", async () => {
    const ruleId = randomUUID();
    await autos.syncSchedule({ id: ruleId, active: true, cron: "45 7 * * *", tz: "Asia/Karachi" });
    let s = (await autos.queue.getJobSchedulers()).find((x) => x.key === `rule:${ruleId}`);
    expect(s).toMatchObject({ pattern: "45 7 * * *", tz: "Asia/Karachi" });
    await autos.syncSchedule({ id: ruleId, active: true, cron: "0 9 * * 1", tz: "Asia/Karachi" });
    s = (await autos.queue.getJobSchedulers()).find((x) => x.key === `rule:${ruleId}`);
    expect(s?.pattern).toBe("0 9 * * 1");
    await autos.syncSchedule({ id: ruleId, active: false });
    expect((await autos.queue.getJobSchedulers()).find((x) => x.key === `rule:${ruleId}`)).toBeUndefined();
  });

  it("run now queues a manual firing", async () => {
    const ruleId = randomUUID();
    await autos.runNow(ruleId);
    const jobs = (await autos.queue.getJobs(["waiting"])).filter((j) => j.data.ruleId === ruleId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data.firedAt).toMatch(/^manual:\d+$/);
  });
});
