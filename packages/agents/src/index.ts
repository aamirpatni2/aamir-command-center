export * from "./model/types.js";
export { AnthropicProvider } from "./model/anthropic.js";
export { MockProvider, type MockStep } from "./model/mock.js";
export { resolveModel, modelAvailability, type ResolvedModel } from "./model/registry.js";
export { estimateCostMicroUsd } from "./model/pricing.js";
export { ToolRegistry } from "./tools/registry.js";
export type { Tool, ToolContext, ToolOutcome } from "./tools/types.js";
export { INTERNAL_TOOLS, kbSearch, memoryPropose } from "./tools/internal.js";
export { AGENTS, SPECIALISTS, orchestrator, orchestratorReview, type AgentDefinition } from "./definitions/index.js";
export { orchestrate, agentCatalogue, type OrchestrationResult, type StepOutcome } from "./orchestration/orchestrate.js";
export { planSchema, stepResultSchema, synthesisSchema, MAX_PLAN_STEPS, type Plan, type StepResult, type Synthesis } from "./orchestration/schemas.js";
export { AgentRunner, type RunParams, type RunResult } from "./runtime/runner.js";
export { executeTask, type ExecuteTaskDeps } from "./runtime/execute-task.js";
export * from "./runtime/events.js";

import { ToolRegistry } from "./tools/registry.js";
import { INTERNAL_TOOLS } from "./tools/internal.js";
import { CRM_TOOLS } from "./tools/crm.js";
/** Registry with every production tool registered. */
export function createDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry().register(...INTERNAL_TOOLS, ...CRM_TOOLS);
}
export { CRM_TOOLS } from "./tools/crm.js";
export * from "./integrations/whatsapp/payload.js";
export * from "./integrations/whatsapp/client.js";
export { createTaskQueue, RedisEventSink, TASK_QUEUE, TRIAGE_JOB, Redis, type TaskQueue } from "./runtime/queue.js";
export { createWhatsappTriageTask } from "./runtime/triage.js";
export { isPresetPlan, type PresetPlan } from "./orchestration/orchestrate.js";
