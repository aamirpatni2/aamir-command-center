import type { ZodType } from "zod";
import type { Database } from "@acc/database";
import type { AgentId, ToolRisk } from "@acc/shared";

export interface ToolContext {
  db: Database;
  taskId: string;
  runId: string;
  agentId: AgentId;
  toolCallId: string;
  signal?: AbortSignal;
}

export interface Tool<I = unknown, O = unknown> {
  /** Capability name, e.g. "kb.search". Agents are granted tools by this name. */
  name: string;
  description: string;
  risk: ToolRisk;
  input: ZodType<I>;
  /** Short human summary shown in the Approval Center for risky tools. */
  describe?: (input: I) => string;
  /**
   * For approval-gated tools: a newer request with the same key replaces older pending ones
   * (e.g. only the latest reply draft per conversation stays pending).
   */
  supersedeKey?: (input: I) => { field: string; value: string };
  run(input: I, ctx: ToolContext): Promise<O>;
  timeoutMs?: number;
}

export type ToolOutcome =
  | { status: "ok"; output: unknown }
  | { status: "error"; code: "NOT_ALLOWED" | "UNKNOWN_TOOL" | "INVALID_INPUT" | "TIMEOUT" | "FAILED"; message: string }
  | { status: "approval_required"; approvalId: string };
