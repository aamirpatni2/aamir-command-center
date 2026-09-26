/**
 * Approval Center state machine. Every transition is a single conditional UPDATE, so two people
 * (or two clicks) can never both approve, and an approved action is claimed by exactly one executor:
 *
 *   pending ──approve──▶ approved ──claim──▶ executing ──▶ executed
 *      │                    ▲  │                    ├────▶ approved (not executed; retryable)
 *      │                    │  └──reject/cancel──▶ rejected
 *      ├──reject──▶ rejected                        └────▶ failed   (outcome unknown; never auto-retried)
 *      └──(expires_at passed / task cancelled)──▶ expired
 */
import { and, eq, inArray, isNotNull, lt, ne, schema, sql, writeAudit, type AuditEntry, type Database } from "@acc/database";
import type { TaskEventSink } from "../runtime/events.js";
import { executorFor, runApprovedAction, type ExecutionOutcome, type ExecutorDeps } from "./executors.js";

export type ApprovalRow = typeof schema.approvals.$inferSelect;

export class ApprovalError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "ALREADY_DECIDED" | "EXPIRED" | "INVALID_EDIT" | "NOT_EXECUTABLE",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ApprovalDeps extends ExecutorDeps {
  events?: TaskEventSink;
}

/** Who acted, for the audit log. */
export type Actor = Pick<AuditEntry, "actorId" | "ip" | "userAgent" | "requestId"> & { actorId: string };

const OPEN_STATUSES = ["pending", "approved", "executing"] as const;

export interface ApprovalRequest {
  tool: { name: string; risk: ApprovalRow["risk"]; supersedeKey?: (input: any) => { field: string; value: string } };
  payload: Record<string, unknown>;
  title: string;
  idempotencyKey: string;
  taskId?: string | null;
  runId?: string | null;
  automationRunId?: string | null;
  /** Agent that asked; null for automations. */
  agentId?: ApprovalRow["requestedByAgent"];
}

/**
 * The one way an approval request is created (agents via the ToolRegistry, and automations).
 * Idempotent on `idempotencyKey`; a newer request with the same supersede key replaces older pending ones.
 */
export async function requestApproval(db: Database, r: ApprovalRequest): Promise<string> {
  const [row] = await db
    .insert(schema.approvals)
    .values({
      taskId: r.taskId ?? null,
      runId: r.runId ?? null,
      automationRunId: r.automationRunId ?? null,
      actionType: r.tool.risk,
      toolName: r.tool.name,
      risk: r.tool.risk,
      title: r.title,
      payload: r.payload,
      requestedByAgent: r.agentId ?? null,
      idempotencyKey: r.idempotencyKey,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    })
    .onConflictDoUpdate({ target: schema.approvals.idempotencyKey, set: { updatedAt: new Date() } })
    .returning({ id: schema.approvals.id });
  const actor = r.agentId ? { actorType: "agent" as const, actorId: r.agentId } : { actorType: "system" as const };
  if (r.tool.supersedeKey) {
    const key = r.tool.supersedeKey(r.payload);
    const superseded = await db
      .update(schema.approvals)
      .set({ status: "expired", decisionNote: "Superseded by a newer draft", decidedAt: new Date() })
      .where(
        and(
          eq(schema.approvals.status, "pending"),
          eq(schema.approvals.toolName, r.tool.name),
          ne(schema.approvals.id, row!.id),
          sql`${schema.approvals.payload}->>${key.field} = ${key.value}`,
        ),
      )
      .returning({ id: schema.approvals.id });
    for (const s of superseded) {
      await writeAudit(db, { ...actor, action: "approval.superseded", entityType: "approval", entityId: s.id, metadata: { by: row!.id } });
    }
  }
  await writeAudit(db, {
    ...actor,
    action: "approval.requested",
    entityType: "approval",
    entityId: row!.id,
    metadata: { tool: r.tool.name, risk: r.tool.risk, taskId: r.taskId ?? null, automationRunId: r.automationRunId ?? null },
  });
  return row!.id;
}

export function editableFieldsFor(toolName: string): readonly string[] {
  return executorFor(toolName)?.tool.editableFields ?? [];
}

async function load(db: Database, id: string): Promise<ApprovalRow> {
  const [row] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, id));
  if (!row) throw new ApprovalError("NOT_FOUND", "Approval not found");
  return row;
}

const alreadyDecided = (row: ApprovalRow) => new ApprovalError("ALREADY_DECIDED", `This action is already ${row.status}`, { status: row.status });

/** Validates edits: only the tool's editable fields, and the merged payload must pass the tool's schema. */
export function validateEdits(row: ApprovalRow, edits: Record<string, unknown>): Record<string, unknown> {
  const executor = executorFor(row.toolName);
  const allowed = executor?.tool.editableFields ?? [];
  const bad = Object.keys(edits).filter((k) => !allowed.includes(k));
  if (bad.length) {
    throw new ApprovalError(
      "INVALID_EDIT",
      allowed.length ? `Only ${allowed.join(", ")} can be edited (not ${bad.join(", ")})` : "This action can't be edited",
    );
  }
  const merged = { ...(row.editedPayload ?? row.payload), ...edits };
  const parsed = executor!.tool.input.safeParse(merged);
  if (!parsed.success) throw new ApprovalError("INVALID_EDIT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data as Record<string, unknown>;
}

async function audit(db: Database, actor: Actor | null, action: string, id: string, metadata: Record<string, unknown>) {
  await writeAudit(db, { ...(actor ?? {}), actorType: actor ? "user" : "system", action, entityType: "approval", entityId: id, metadata });
}

export async function editApproval(db: Database, id: string, edits: Record<string, unknown>, actor: Actor): Promise<ApprovalRow> {
  const row = await load(db, id);
  if (row.status !== "pending") throw alreadyDecided(row);
  const merged = validateEdits(row, edits);
  const [updated] = await db
    .update(schema.approvals)
    .set({ editedPayload: merged })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, "pending")))
    .returning();
  if (!updated) throw alreadyDecided(await load(db, id));
  await audit(db, actor, "approval.edit", id, { tool: row.toolName, fields: Object.keys(edits) });
  return updated;
}

export async function approveApproval(
  deps: ApprovalDeps,
  id: string,
  opts: { note?: string | null; edits?: Record<string, unknown> },
  actor: Actor,
): Promise<{ approval: ApprovalRow; outcome: ExecutionOutcome }> {
  const { db } = deps;
  const row = await load(db, id);
  if (row.status !== "pending") throw alreadyDecided(row);
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    await expireStaleApprovals(deps);
    throw new ApprovalError("EXPIRED", "This request expired without a decision");
  }
  const edited = opts.edits && Object.keys(opts.edits).length ? validateEdits(row, opts.edits) : undefined;

  const [approved] = await db
    .update(schema.approvals)
    .set({
      status: "approved",
      decidedBy: actor.actorId,
      decidedAt: new Date(),
      decisionNote: opts.note ?? null,
      ...(edited ? { editedPayload: edited } : {}),
    })
    .where(
      and(
        eq(schema.approvals.id, id),
        eq(schema.approvals.status, "pending"),
        sql`(${schema.approvals.expiresAt} is null or ${schema.approvals.expiresAt} > now())`,
      ),
    )
    .returning();
  if (!approved) throw alreadyDecided(await load(db, id));
  await audit(db, actor, "approval.approve", id, {
    tool: row.toolName,
    risk: row.risk,
    edited: approved.editedPayload !== null,
    ...(edited ? { editedFields: Object.keys(opts.edits!) } : {}),
  });
  return executeApproval(deps, id, actor);
}

/**
 * Claims an approved action and runs it once. Also used to retry an action that was approved but not
 * executed (e.g. WhatsApp wasn't configured yet). Actions whose outcome is unknown are never retried.
 */
export async function executeApproval(deps: ApprovalDeps, id: string, actor: Actor): Promise<{ approval: ApprovalRow; outcome: ExecutionOutcome }> {
  const { db } = deps;
  const [claimed] = await db
    .update(schema.approvals)
    .set({ status: "executing", executionAttempts: sql`${schema.approvals.executionAttempts} + 1` })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, "approved")))
    .returning();
  if (!claimed) {
    const row = await load(db, id);
    throw new ApprovalError("NOT_EXECUTABLE", `Only approved, not-yet-executed actions can run (this one is ${row.status})`, { status: row.status });
  }

  const outcome = await runApprovedAction(claimed.toolName, claimed, deps);
  const at = new Date().toISOString();
  const next =
    outcome.status === "executed"
      ? { status: "executed" as const, executedAt: new Date(), executionResult: { status: "executed", at, ...outcome.result } }
      : outcome.status === "not_executed"
        ? { status: "approved" as const, executionResult: { status: "not_executed", at, code: outcome.code, message: outcome.message, details: outcome.details ?? null, retryable: true } }
        : { status: "failed" as const, executionResult: { status: "unknown", at, message: outcome.message, retryable: false } };

  const [updated] = await db
    .update(schema.approvals)
    .set(next)
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, "executing")))
    .returning();
  await audit(
    db,
    actor,
    outcome.status === "executed" ? "approval.executed" : outcome.status === "not_executed" ? "approval.not_executed" : "approval.execution_failed",
    id,
    { tool: claimed.toolName, attempt: claimed.executionAttempts, ...(outcome.status === "not_executed" ? { code: outcome.code } : {}) },
  );
  await settleTask(deps, claimed.taskId);
  return { approval: updated ?? (await load(db, id)), outcome };
}

/** Reject a pending request, or cancel one that was approved but never executed. */
export async function rejectApproval(deps: ApprovalDeps, id: string, note: string | null, actor: Actor): Promise<ApprovalRow> {
  const { db } = deps;
  const [rejected] = await db
    .update(schema.approvals)
    .set({ status: "rejected", decidedBy: actor.actorId, decidedAt: new Date(), decisionNote: note })
    .where(and(eq(schema.approvals.id, id), inArray(schema.approvals.status, ["pending", "approved"])))
    .returning();
  if (!rejected) throw alreadyDecided(await load(db, id));
  await audit(db, actor, "approval.reject", id, { tool: rejected.toolName, risk: rejected.risk, afterApproval: rejected.executionAttempts > 0 });
  await settleTask(deps, rejected.taskId);
  return rejected;
}

/** Marks pending requests past their expiry as expired. Cheap; called before listing and deciding. */
export async function expireStaleApprovals(deps: Pick<ApprovalDeps, "db" | "events">): Promise<number> {
  const rows = await deps.db
    .update(schema.approvals)
    .set({ status: "expired", decidedAt: new Date(), decisionNote: "Expired without a decision" })
    .where(and(eq(schema.approvals.status, "pending"), isNotNull(schema.approvals.expiresAt), lt(schema.approvals.expiresAt, new Date())))
    .returning({ id: schema.approvals.id, taskId: schema.approvals.taskId });
  for (const r of rows) await audit(deps.db, null, "approval.expired", r.id, {});
  for (const taskId of new Set(rows.map((r) => r.taskId))) await settleTask(deps, taskId);
  return rows.length;
}

/** Expires the pending requests of a cancelled task, so nothing it asked for can still be approved. */
export async function expireTaskApprovals(deps: Pick<ApprovalDeps, "db">, taskId: string, reason: string): Promise<number> {
  const rows = await deps.db
    .update(schema.approvals)
    .set({ status: "expired", decidedAt: new Date(), decisionNote: reason })
    .where(and(eq(schema.approvals.taskId, taskId), eq(schema.approvals.status, "pending")))
    .returning({ id: schema.approvals.id });
  for (const r of rows) await audit(deps.db, null, "approval.expired", r.id, { reason });
  return rows.length;
}

/**
 * Resumes a WAITING_APPROVAL task once none of its approvals is open: the task completes and its
 * result records what happened to each request. Agents are not re-run; follow-ups are new tasks.
 */
export async function settleTask(deps: Pick<ApprovalDeps, "db" | "events">, taskId: string | null): Promise<boolean> {
  if (!taskId) return false;
  const { db } = deps;
  const all = await db
    .select({ id: schema.approvals.id, title: schema.approvals.title, tool: schema.approvals.toolName, status: schema.approvals.status })
    .from(schema.approvals)
    .where(eq(schema.approvals.taskId, taskId));
  if (all.some((a) => (OPEN_STATUSES as readonly string[]).includes(a.status))) return false;
  const [task] = await db
    .update(schema.agentTasks)
    .set({
      status: "COMPLETED",
      finishedAt: new Date(),
      result: sql`coalesce(${schema.agentTasks.result}, '{}'::jsonb) || ${JSON.stringify({ approvalOutcomes: all })}::jsonb`,
    })
    .where(and(eq(schema.agentTasks.id, taskId), eq(schema.agentTasks.status, "WAITING_APPROVAL")))
    .returning({ id: schema.agentTasks.id });
  if (!task) return false;
  await writeAudit(db, { actorType: "system", action: "task.completed", entityType: "agent_task", entityId: taskId, metadata: { reason: "approvals_settled" } });
  await deps.events?.publish({ type: "task.status", taskId, status: "COMPLETED" });
  return true;
}
