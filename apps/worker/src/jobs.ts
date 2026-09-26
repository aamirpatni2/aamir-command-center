/**
 * Job handlers for the worker, separated from process startup so they can be tested.
 */
import type { Logger } from "pino";
import { and, eq, isNull, schema, type Database } from "@acc/database";
import {
  createWhatsappTriageTask, executeTask, handleEvent, handleSchedule, handleSweep, ruleFromRow, SWEEP_EVERY_MS, TRIAGE_JOB,
  type AutomationJob, type AutomationQueue, type EngineDeps, type ExecuteTaskDeps,
} from "@acc/agents";
import type { AutomationEvent } from "@acc/shared";

export interface JobLike<T> {
  id?: string;
  name: string;
  data: T;
  timestamp?: number;
  opts?: { delay?: number };
}

/** Never leave a task stuck in RUNNING/QUEUED when its job dies outside the runner's own error handling. */
export async function markCrashed(db: Database, taskId: string, message = "Worker crashed while running this task. See logs.") {
  const [row] = await db
    .update(schema.agentTasks)
    .set({ status: "FAILED", error: message, finishedAt: new Date() })
    .where(and(eq(schema.agentTasks.id, taskId), isNull(schema.agentTasks.finishedAt)))
    .returning({ id: schema.agentTasks.id, status: schema.agentTasks.status });
  return !!row;
}

export async function processTaskJob(deps: ExecuteTaskDeps, job: JobLike<{ taskId?: string; conversationId?: string }>) {
  let taskId = job.data.taskId;
  if (job.name === TRIAGE_JOB && job.data.conversationId) {
    const task = await createWhatsappTriageTask(deps.db, job.data.conversationId);
    if (!task) return { status: "skipped" as const, reason: "conversation not found" };
    taskId = task.id;
  }
  if (!taskId) return { status: "skipped" as const, reason: "no task" };
  const log = deps.logger.child({ taskId, jobId: job.id, job: job.name });
  log.info("task picked up");
  try {
    const status = await executeTask(taskId, { ...deps, logger: log });
    log.info({ status }, "task finished");
    return { status, taskId };
  } catch (err) {
    // Includes triage tasks, whose job data has no taskId for the queue's failure handler to find.
    log.error({ err }, "task crashed");
    await markCrashed(deps.db, taskId);
    throw err;
  }
}

export async function processAutomationJob(engine: EngineDeps, job: JobLike<AutomationJob>, logger: Logger) {
  const log = logger.child({ job: job.name, jobId: job.id });
  const d = job.data;
  if (d.kind === "event" && d.event) {
    const out = await handleEvent(engine, d.event as AutomationEvent, d.ref ?? {});
    if (out.length) log.info({ event: d.event, results: out.map((o) => `${o.ruleId}:${o.outcome.status}`) }, "automation event handled");
    return { rules: out.length, results: out };
  }
  if (d.kind === "schedule" && d.ruleId) {
    // Scheduler jobs carry their planned time; manual runs carry "manual:<ts>".
    const firedAt = d.firedAt ?? new Date((job.timestamp ?? Date.now()) + (job.opts?.delay ?? 0)).toISOString();
    const outcome = await handleSchedule(engine, d.ruleId, firedAt);
    log.info({ ruleId: d.ruleId, status: outcome?.status ?? "skipped" }, "scheduled automation");
    return { status: outcome?.status ?? "skipped" };
  }
  if (d.kind === "sweep") {
    const r = await handleSweep(engine);
    if (r.fired) log.info(r, "automation sweep");
    return r;
  }
  return { status: "ignored" };
}

/** The database is the source of truth for schedules: re-create repeatable jobs on every start. */
export async function syncSchedules(
  db: Database,
  queue: Pick<AutomationQueue, "syncSchedule"> & {
    queue: { getJobSchedulers(): Promise<{ key: string }[]>; removeJobScheduler(key: string): Promise<unknown>; upsertJobScheduler(...args: any[]): Promise<unknown> };
  },
) {
  const rules = await db.select().from(schema.automationRules).where(isNull(schema.automationRules.deletedAt));
  const wanted = new Set<string>();
  for (const r of rules) {
    const def = ruleFromRow(r);
    if (def.trigger.event !== "schedule") continue;
    if (r.enabled) wanted.add(`rule:${r.id}`);
    await queue.syncSchedule({ id: r.id, active: r.enabled, cron: def.trigger.cron, tz: def.trigger.tz });
  }
  const removed: string[] = [];
  for (const s of await queue.queue.getJobSchedulers()) {
    if (s.key.startsWith("rule:") && !wanted.has(s.key)) {
      await queue.queue.removeJobScheduler(s.key);
      removed.push(s.key);
    }
  }
  await queue.queue.upsertJobScheduler("sweep", { every: SWEEP_EVERY_MS }, { name: "sweep", data: { kind: "sweep" } });
  return { schedules: wanted.size, removed };
}
