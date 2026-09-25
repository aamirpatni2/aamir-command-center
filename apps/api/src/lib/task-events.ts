import { Redis } from "ioredis";
import { taskChannel, type TaskEvent } from "@acc/agents";

type Listener = (event: TaskEvent) => void;

/**
 * One shared Redis subscription for all SSE clients. Listeners are keyed by task id.
 */
export class TaskEventHub {
  private sub: Redis | null = null;
  private pub: Redis | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(private readonly redisUrl: string) {}

  private ensure() {
    if (this.sub) return;
    this.sub = new Redis(this.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
    this.sub.psubscribe(taskChannel("*")).catch(() => {});
    this.sub.on("pmessage", (_pattern, channel, message) => {
      const taskId = channel.slice(taskChannel("").length);
      const set = this.listeners.get(taskId);
      if (!set) return;
      try {
        const event = JSON.parse(message) as TaskEvent;
        for (const l of set) l(event);
      } catch {
        /* ignore malformed */
      }
    });
  }

  subscribe(taskId: string, listener: Listener): () => void {
    this.ensure();
    let set = this.listeners.get(taskId);
    if (!set) this.listeners.set(taskId, (set = new Set()));
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(taskId);
    };
  }

  async publish(event: TaskEvent) {
    this.pub ??= new Redis(this.redisUrl, { maxRetriesPerRequest: 1 });
    await this.pub.publish(taskChannel(event.taskId), JSON.stringify(event));
  }

  async close() {
    await Promise.all([this.sub?.quit(), this.pub?.quit()].filter(Boolean));
  }
}
