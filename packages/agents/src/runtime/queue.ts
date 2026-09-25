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
export function createTaskQueue(redisUrl: string): TaskQueue {
  const queue = new Queue(TASK_QUEUE, {
    connection: { url: redisUrl },
    defaultJobOptions: {
      // No automatic retries: a retried agent run could repeat side effects. Failed tasks are re-run deliberately.
      attempts: 1,
      removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  });
  return {
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
