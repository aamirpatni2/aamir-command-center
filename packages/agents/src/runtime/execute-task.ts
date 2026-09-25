import type { Logger } from "pino";
import { and, eq, schema, writeAudit, type Database } from "@acc/database";
import type { TaskStatus } from "@acc/shared";
import { orchestrate, type OrchestrationResult } from "../orchestration/orchestrate.js";
import type { ResolvedModel } from "../model/registry.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { TaskEventSink } from "./events.js";

export interface ExecuteTaskDeps {
  db: Database;
  tools: ToolRegistry;
  events: TaskEventSink;
  logger: Logger;
  /** Resolves the provider/model for an agent (real provider, or mock in dev/test). */
  resolve: (selector?: { provider?: string; model?: string }) => ResolvedModel;
}

/**
 * Runs a queued task through the Orchestrator (plan → delegate → verify → summarise).
 */
export async function executeTask(taskId: string, deps: ExecuteTaskDeps): Promise<TaskStatus | null> {
  const { db, events, logger } = deps;

  // Claim atomically: only a QUEUED task moves to RUNNING (duplicate jobs become no-ops).
  const [task] = await db
    .update(schema.agentTasks)
    .set({ status: "RUNNING", startedAt: new Date() })
    .where(and(eq(schema.agentTasks.id, taskId), eq(schema.agentTasks.status, "QUEUED")))
    .returning();
  if (!task) {
    logger.info({ taskId }, "task not claimable (missing, already running, or cancelled)");
    return null;
  }
  await events.publish({ type: "task.status", taskId, status: "RUNNING" });

  const finish = async (status: TaskStatus, fields: { result?: Record<string, unknown>; error?: string | null }) => {
    // Don't overwrite a cancellation that happened while the run was in flight.
    const [current] = await db.select({ status: schema.agentTasks.status }).from(schema.agentTasks).where(eq(schema.agentTasks.id, taskId));
    const final: TaskStatus = current?.status === "CANCELLED" ? "CANCELLED" : status;
    await db
      .update(schema.agentTasks)
      .set({ status: final, result: fields.result ?? null, error: fields.error ?? null, finishedAt: final === "WAITING_APPROVAL" ? null : new Date() })
      .where(eq(schema.agentTasks.id, taskId));
    await writeAudit(db, { actorType: "system", action: `task.${final.toLowerCase()}`, entityType: "agent_task", entityId: taskId });
    await events.publish({ type: "task.status", taskId, status: final, error: fields.error ?? null });
    return final;
  };

  let result: OrchestrationResult;
  try {
    result = await orchestrate({ id: taskId, input: task.input }, deps);
  } catch (e) {
    // Model not configured, or an unexpected error outside a run.
    return finish("FAILED", { error: (e as Error).message });
  }

  return finish(result.status, {
    result: {
      text: result.text,
      issues: result.issues,
      nextSteps: result.nextSteps,
      approvalIds: result.approvalIds,
      steps: result.steps.map((s) => ({ position: s.position, agent: s.agent, status: s.status, runId: s.runId ?? null, error: s.error ?? null })),
      mock: result.mock,
    },
    error: result.error ?? null,
  });
}
