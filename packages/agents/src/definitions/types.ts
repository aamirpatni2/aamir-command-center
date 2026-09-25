import type { ZodType } from "zod";
import type { AgentId } from "@acc/shared";
import type { Effort } from "../model/types.js";

export interface AgentDefinition {
  id: AgentId;
  /** Used by the Orchestrator for routing (Milestone 4). */
  description: string;
  systemPrompt: string;
  model?: { provider?: string; model?: string };
  effort?: Effort;
  /** Allow-list enforced by the ToolRegistry. */
  tools: readonly string[];
  /** Hard cap on model calls per run. */
  maxSteps: number;
  /** When set, the agent must return its result through the `finish` tool matching this schema. */
  outputSchema?: ZodType;
}
