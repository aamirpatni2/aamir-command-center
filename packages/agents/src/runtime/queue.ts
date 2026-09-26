import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { taskChannel, type TaskEvent, type TaskEventSink } from "./events.js";

export const TASK_QUEUE = "agent-tasks";

export const TRIAGE_JOB = "whatsapp-triage";

export interface TaskQueue {
  enqueue(taskId: string): Promise<void>;
  /** Debounced: messages in the same window for one conversation produce one triage. */
  enqueueTriage(conversationId: string, delayMs: number): Promise<void>;
  close(): Promise<void>;
}

/** BullMQ-backed queue. jobId = taskId, so enqueuing the same task twice is a no-op. */
export function createTaskQueue(redisUrl: string, opts: { prefix?: string } = {}): TaskQueue & { queue: Queue } {
  const queue = new Queue(TASK_QUEUE, {
    connection: { url: redisUrl },
    ...(opts.prefix ? { prefix: opts.prefix } : {}),
    defaultJobOptions: {
      // No automatic retries: a retried agent run could repeat side effects. Failed tasks are re-run deliberately.
      attempts: 1,
      removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  });
  return {
    queue,
    enqueue: async (taskId) => {
      await queue.add("execute", { taskId }, { jobId: taskId });
    },
    enqueueTriage: async (conversationId, delayMs) => {
      const bucket = Math.floor(Date.now() / Math.max(delayMs, 1000));
      await queue.add(TRIAGE_JOB, { conversationId }, { jobId: `triage:${conversationId}:${bucket}`, delay: delayMs, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } });
    },
    close: () => queue.close(),
  };
}

/** Publishes task events on Redis pub/sub for the API's SSE stream. */
export class RedisEventSink implements TaskEventSink {
  constructor(private readonly redis: Redis) {}
  async publish(event: TaskEvent) {
    await this.redis.publish(taskChannel(event.taskId), JSON.stringify(event));
  }
}

export { Redis };

// ── Automations ───────────────────────────────────────────────────────────
export const AUTOMATION_QUEUE = "automations";
export const SWEEP_EVERY_MS = 10 * 60_000;

export interface AutomationJob {
  kind: "event" | "schedule" | "sweep";
  event?: string;
  ref?: Record<string, unknown>;
  ruleId?: string;
  firedAt?: string;
}

/** BullMQ rejects custom job ids containing ":" (reserved for its own keys). */
export const automationJobId = (...parts: string[]) => parts.join("__").replace(/:/g, "-");

export interface AutomationQueue {
  /** Fire-and-forget: callers must never fail their own request because Redis is down. */
  emit(event: string, ref: Record<string, unknown>, refId: string): Promise<void>;
  /** Creates, updates or removes the repeatable job for a schedule rule. */
  syncSchedule(rule: { id: string; active: boolean; cron?: string; tz?: string }): Promise<void>;
  runNow(ruleId: string): Promise<void>;
  close(): Promise<void>;
}

export function createAutomationQueue(redisUrl: string, opts: { prefix?: string } = {}): AutomationQueue & { queue: Queue } {
  const queue = new Queue<AutomationJob>(AUTOMATION_QUEUE, {
    connection: { url: redisUrl },
    ...(opts.prefix ? { prefix: opts.prefix } : {}),
    defaultJobOptions: { attempts: 1, removeOnComplete: { age: 3 * 24 * 3600, count: 2000 }, removeOnFail: { age: 14 * 24 * 3600 } },
  });
  return {
    queue,
    emit: async (event, ref, refId) => {
      // jobId dedupes a second delivery of the same event at the queue level (the DB unique index is the real guard).
      await queue.add("event", { kind: "event", event, ref }, { jobId: automationJobId(event, refId) });
    },
    syncSchedule: async (rule) => {
      const id = `rule:${rule.id}`;
      if (rule.active && rule.cron) {
        await queue.upsertJobScheduler(id, { pattern: rule.cron, tz: rule.tz }, { name: "schedule", data: { kind: "schedule", ruleId: rule.id } });
      } else {
        await queue.removeJobScheduler(id);
      }
    },
    runNow: async (ruleId) => {
      const firedAt = `manual:${Date.now()}`;
      await queue.add("schedule", { kind: "schedule", ruleId, firedAt }, { jobId: automationJobId(ruleId, firedAt) });
    },
    close: () => queue.close(),
  };
}
