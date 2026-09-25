import type { TaskStatus } from "@acc/shared";

export type TaskEvent =
  | { type: "task.status"; taskId: string; status: TaskStatus; error?: string | null }
  | { type: "run.started"; taskId: string; runId: string; agentId: string; model: string; mock: boolean }
  | { type: "run.step"; taskId: string; runId: string; seq: number; role: string; toolName?: string | null; isError?: boolean; preview: string }
  | { type: "run.finished"; taskId: string; runId: string; status: TaskStatus; errorCode?: string | null };

export interface TaskEventSink {
  publish(event: TaskEvent): Promise<void>;
}

export const taskChannel = (taskId: string) => `acc:task:${taskId}`;

export class MemoryEventSink implements TaskEventSink {
  readonly events: TaskEvent[] = [];
  async publish(event: TaskEvent) {
    this.events.push(event);
  }
}
