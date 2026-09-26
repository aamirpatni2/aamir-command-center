import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common.js";
import {
  agentId,
  agentMessageRole,
  approvalStatus,
  automationTrigger,
  memoryKind,
  memoryStatus,
  taskSource,
  taskStatus,
  toolRisk,
} from "./enums.js";
import { users } from "./identity.js";

export const automationRules = pgTable("automation_rules", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  trigger: automationTrigger("trigger").notNull(),
  /** e.g. { event: "lead.created" } or { cron: "0 7 * * *", tz: "Asia/Karachi" } */
  triggerConfig: jsonb("trigger_config").$type<Record<string, unknown>>().notNull(),
  conditions: jsonb("conditions").$type<Record<string, unknown>[]>().notNull().default([]),
  steps: jsonb("steps").$type<Record<string, unknown>[]>().notNull().default([]),
  /** Owner-defined auto-approval scope. Empty = every risky action needs approval. */
  policy: jsonb("policy").$type<{ maxRunsPerHour?: number; autoApprove?: { tool: string; templateIds?: string[] }[] }>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  runCount: integer("run_count").notNull().default(0),
  ...timestamps,
  ...softDelete,
});

export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: id(),
    title: text("title").notNull(),
    input: text("input").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id),
    source: taskSource("source").notNull().default("user"),
    automationRuleId: uuid("automation_rule_id").references(() => automationRules.id),
    status: taskStatus("status").notNull().default("QUEUED"),
    priority: integer("priority").notNull().default(0),
    plan: jsonb("plan").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("agent_tasks_status_idx").on(t.status, t.createdAt)],
);

export const agentSteps = pgTable(
  "agent_steps",
  {
    id: id(),
    taskId: uuid("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    agentId: agentId("agent_id").notNull(),
    instruction: text("instruction").notNull(),
    dependsOn: integer("depends_on").array().notNull().default([]),
    status: taskStatus("status").notNull().default("QUEUED"),
    ...timestamps,
  },
  (t) => [uniqueIndex("agent_steps_task_position_unique").on(t.taskId, t.position)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    taskId: uuid("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => agentSteps.id),
    parentRunId: uuid("parent_run_id").references((): AnyPgColumn => agentRuns.id),
    agentId: agentId("agent_id").notNull(),
    status: taskStatus("status").notNull().default("QUEUED"),
    modelProvider: text("model_provider"),
    model: text("model"),
    input: jsonb("input").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    state: jsonb("state").$type<Record<string, unknown>>(),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("agent_runs_task_idx").on(t.taskId),
    index("agent_runs_agent_status_idx").on(t.agentId, t.status),
    index("agent_runs_created_idx").on(t.createdAt),
  ],
);

/** Append-only transcript of a run, including tool calls and tool results. */
export const agentMessages = pgTable(
  "agent_messages",
  {
    id: id(),
    runId: uuid("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: agentMessageRole("role").notNull(),
    content: jsonb("content").notNull(),
    toolName: text("tool_name"),
    toolCallId: text("tool_call_id"),
    toolRisk: toolRisk("tool_risk"),
    latencyMs: integer("latency_ms"),
    isError: boolean("is_error").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_messages_run_seq_unique").on(t.runId, t.seq)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    taskId: uuid("task_id").references(() => agentTasks.id),
    runId: uuid("run_id").references(() => agentRuns.id),
    actionType: text("action_type").notNull(),
    toolName: text("tool_name").notNull(),
    risk: toolRisk("risk").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    editedPayload: jsonb("edited_payload").$type<Record<string, unknown>>(),
    status: approvalStatus("status").notNull().default("pending"),
    requestedByAgent: agentId("requested_by_agent"),
    requestedByUser: uuid("requested_by_user").references(() => users.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** Guarantees an approved action executes at most once. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** Set when an automation (not an agent) asked for this action. */
    automationRunId: uuid("automation_run_id").references((): AnyPgColumn => automationRuns.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    executionResult: jsonb("execution_result").$type<Record<string, unknown>>(),
    executionAttempts: integer("execution_attempts").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("approvals_idempotency_unique").on(t.idempotencyKey),
    index("approvals_status_idx").on(t.status, t.createdAt),
    index("approvals_task_idx").on(t.taskId),
  ],
);

export const memoryItems = pgTable(
  "memory_items",
  {
    id: id(),
    kind: memoryKind("kind").notNull(),
    subject: text("subject").notNull(),
    content: text("content").notNull(),
    source: text("source").notNull(),
    status: memoryStatus("status").notNull().default("proposed"),
    confidence: real("confidence"),
    sourceRunId: uuid("source_run_id").references(() => agentRuns.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("memory_items_kind_status_idx").on(t.kind, t.status), index("memory_items_subject_idx").on(t.subject)],
);

/**
 * One row per rule firing (conditions matched, or a dry run is not stored). The unique
 * (rule_id, dedupe_key) makes each event fire a rule at most once, even if delivered twice.
 */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    ruleId: uuid("rule_id").notNull().references(() => automationRules.id),
    event: text("event").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    /** completed | partial | failed | rate_limited */
    status: text("status").notNull(),
    /** Small snapshot of the triggering context (ids, band, …); no message bodies. */
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    actions: jsonb("actions").$type<Record<string, unknown>[]>().notNull().default([]),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("automation_runs_dedupe_unique").on(t.ruleId, t.dedupeKey), index("automation_runs_rule_idx").on(t.ruleId, t.createdAt)],
);
