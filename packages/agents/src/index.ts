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
import { EDUCATION_TOOLS } from "./tools/education.js";
import { CONTENT_TOOLS } from "./tools/content.js";
import { makeKbSearch, makeWebFetch, makeWebSearch, researchSave } from "./tools/research.js";
import { memoryPropose } from "./tools/internal.js";
import type { Embedder } from "@acc/database";
import type { WebSearchProvider } from "./integrations/web/search.js";
import type { Resolver } from "./integrations/web/fetch.js";

export interface ToolRegistryOptions {
  webSearch?: WebSearchProvider | null;
  embedder?: Embedder | null;
  /** For tests: fake network and DNS for web.fetch. */
  fetchImpl?: typeof fetch;
  resolve?: Resolver;
}

/** Registry with every production tool registered. Integrations that aren't configured report not_configured. */
export function createDefaultToolRegistry(opts: ToolRegistryOptions = {}): ToolRegistry {
  return new ToolRegistry().register(
    makeKbSearch(opts.embedder ?? null),
    memoryPropose,
    ...CRM_TOOLS,
    ...EDUCATION_TOOLS,
    ...CONTENT_TOOLS,
    makeWebSearch(opts.webSearch ?? null),
    makeWebFetch({ enabled: !!opts.webSearch, fetchImpl: opts.fetchImpl, resolve: opts.resolve }),
    researchSave,
  );
}
export { makeKbSearch, makeWebFetch, makeWebSearch, researchSave } from "./tools/research.js";
export * from "./integrations/web/search.js";
export * from "./integrations/web/fetch.js";
export * from "./integrations/embeddings/voyage.js";
export { CRM_TOOLS } from "./tools/crm.js";
export { EDUCATION_TOOLS } from "./tools/education.js";
export { CONTENT_TOOLS } from "./tools/content.js";
export * from "./integrations/whatsapp/payload.js";
export * from "./integrations/whatsapp/client.js";
export { createTaskQueue, RedisEventSink, TASK_QUEUE, TRIAGE_JOB, Redis, type TaskQueue } from "./runtime/queue.js";
export { createWhatsappTriageTask } from "./runtime/triage.js";
export { isPresetPlan, type PresetPlan } from "./orchestration/orchestrate.js";
export * from "./approvals/executors.js";
export * from "./approvals/service.js";
