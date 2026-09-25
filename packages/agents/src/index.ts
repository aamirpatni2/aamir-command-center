export * from "./model/types.js";
export { AnthropicProvider } from "./model/anthropic.js";
export { MockProvider, type MockStep } from "./model/mock.js";
export { resolveModel, modelAvailability, type ResolvedModel } from "./model/registry.js";
export { estimateCostMicroUsd } from "./model/pricing.js";
export { ToolRegistry } from "./tools/registry.js";
export type { Tool, ToolContext, ToolOutcome } from "./tools/types.js";
export { INTERNAL_TOOLS, kbSearch, memoryPropose } from "./tools/internal.js";
export { AGENTS, orchestrator, type AgentDefinition } from "./definitions/index.js";
export { AgentRunner, type RunParams, type RunResult } from "./runtime/runner.js";
export { executeTask, type ExecuteTaskDeps } from "./runtime/execute-task.js";
export * from "./runtime/events.js";

import { ToolRegistry } from "./tools/registry.js";
import { INTERNAL_TOOLS } from "./tools/internal.js";
/** Registry with every production tool registered. */
export function createDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry().register(...INTERNAL_TOOLS);
}
export { createTaskQueue, RedisEventSink, TASK_QUEUE, Redis, type TaskQueue } from "./runtime/queue.js";
