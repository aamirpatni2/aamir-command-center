import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";
import { z } from "zod";
import { eq, schema, type Database } from "@acc/database";
import type { TaskStatus } from "@acc/shared";
import type { AgentDefinition } from "../definitions/types.js";
import { estimateCostMicroUsd } from "../model/pricing.js";
import type { ChatMessage, ModelProvider, ModelResponse, ToolResultMessage, ToolSpec } from "../model/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { TaskEventSink } from "./events.js";

const MAX_TOOL_RESULT_CHARS = 20_000;
const FINISH_TOOL = "finish";

export interface RunParams {
  taskId: string;
  agent: AgentDefinition;
  input: string;
  provider: ModelProvider;
  model: string;
  stepId?: string;
  parentRunId?: string;
}

export interface RunResult {
  runId: string;
  status: Extract<TaskStatus, "COMPLETED" | "WAITING_APPROVAL" | "FAILED" | "CANCELLED">;
  text: string;
  output?: unknown;
  approvalIds: string[];
  errorCode?: string;
  errorMessage?: string;
}

export interface RunnerDeps {
  db: Database;
  tools: ToolRegistry;
  events: TaskEventSink;
  logger: Logger;
}

class RunFailure extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

const preview = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Executes one agent run: the model ↔ tool loop, with every message persisted to
 * agent_messages and totals written to agent_runs.
 */
export class AgentRunner {
  constructor(private readonly deps: RunnerDeps) {}

  async run(p: RunParams): Promise<RunResult> {
    const { db, events, logger } = this.deps;
    const started = Date.now();
    const [runRow] = await db
      .insert(schema.agentRuns)
      .values({
        taskId: p.taskId,
        stepId: p.stepId ?? null,
        parentRunId: p.parentRunId ?? null,
        agentId: p.agent.id,
        status: "RUNNING",
        modelProvider: p.provider.id,
        model: p.model,
        input: { text: p.input },
        startedAt: new Date(started),
      })
      .returning({ id: schema.agentRuns.id });
    const runId = runRow!.id;
    const log = logger.child({ runId, taskId: p.taskId, agent: p.agent.id, model: p.model, provider: p.provider.id });
    await events.publish({ type: "run.started", taskId: p.taskId, runId, agentId: p.agent.id, model: p.model, mock: p.provider.isMock });
    log.info("agent run started");

    let seq = 0;
    const record = async (
      role: "system" | "user" | "assistant" | "tool",
      content: unknown,
      extra: { toolName?: string; toolCallId?: string; toolRisk?: string; latencyMs?: number; isError?: boolean; preview?: string } = {},
    ) => {
      const s = seq++;
      await db.insert(schema.agentMessages).values({
        runId,
        seq: s,
        role,
        content: content as object,
        toolName: extra.toolName ?? null,
        toolCallId: extra.toolCallId ?? null,
        toolRisk: (extra.toolRisk as never) ?? null,
        latencyMs: extra.latencyMs ?? null,
        isError: extra.isError ?? false,
      });
      await events.publish({
        type: "run.step",
        taskId: p.taskId,
        runId,
        seq: s,
        role,
        toolName: extra.toolName ?? null,
        isError: extra.isError ?? false,
        preview: preview(extra.preview ?? ""),
      });
    };

    const usage = { input: 0, output: 0 };
    let toolCallCount = 0;
    const approvalIds: string[] = [];
    let finalText = "";
    let output: unknown;
    let servedModel = p.model;
    let result: RunResult;

    try {
      const allowed = this.deps.tools.allowedFor(p.agent.id, p.agent.tools);
      const specs: ToolSpec[] = this.deps.tools.specsFor(allowed);
      if (p.agent.outputSchema) {
        const s = z.toJSONSchema(p.agent.outputSchema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
        delete s.$schema;
        specs.push({ name: FINISH_TOOL, description: "Submit your final structured result. Call exactly once, when done.", inputSchema: s });
      }

      const messages: ChatMessage[] = [{ role: "user", content: p.input }];
      await record("system", { text: p.agent.systemPrompt }, { preview: "system prompt" });
      await record("user", { text: p.input }, { preview: p.input });

      let done = false;
      let nudged = false;
      for (let step = 0; step < p.agent.maxSteps && !done; step++) {
        await this.assertNotCancelled(p.taskId);

        const t0 = Date.now();
        const res: ModelResponse = await p.provider.generate({
          model: p.model,
          system: p.agent.systemPrompt,
          messages,
          tools: specs,
          effort: p.agent.effort,
        });
        usage.input += res.usage.inputTokens;
        usage.output += res.usage.outputTokens;
        servedModel = res.servedModel;
        messages.push({ role: "assistant", text: res.text, toolCalls: res.toolCalls, raw: res.raw });
        await record(
          "assistant",
          { text: res.text, toolCalls: res.toolCalls, stopReason: res.stopReason, servedModel: res.servedModel, usage: res.usage },
          { latencyMs: Date.now() - t0, preview: res.text || res.toolCalls.map((c) => `→ ${c.name}`).join(", ") },
        );

        if (res.stopReason === "refusal") {
          throw new RunFailure("MODEL_REFUSAL", `The model declined this request${res.refusal?.category ? ` (${res.refusal.category})` : ""}.`);
        }
        if (res.stopReason === "max_tokens") {
          throw new RunFailure("MAX_TOKENS", "The model hit its output limit before finishing.");
        }

        if (res.toolCalls.length === 0) {
          finalText = res.text;
          if (p.agent.outputSchema && output === undefined && !nudged) {
            nudged = true;
            messages.push({ role: "user", content: `Submit your result by calling the ${FINISH_TOOL} tool.` });
            continue;
          }
          done = true;
          break;
        }

        const results: ToolResultMessage[] = [];
        for (const call of res.toolCalls) {
          toolCallCount++;
          if (call.name === FINISH_TOOL && p.agent.outputSchema) {
            const parsed = p.agent.outputSchema.safeParse(call.input);
            if (parsed.success) {
              output = parsed.data;
              finalText = res.text;
              done = true;
              results.push({ toolCallId: call.id, content: "Result accepted.", isError: false });
            } else {
              results.push({ toolCallId: call.id, content: `Invalid result: ${parsed.error.message}`, isError: true });
            }
            await record("tool", results.at(-1), { toolName: FINISH_TOOL, toolCallId: call.id, isError: !parsed.success, preview: parsed.success ? "result accepted" : "invalid result" });
            continue;
          }

          const t1 = Date.now();
          const outcome = await this.deps.tools.execute(allowed, call, {
            db,
            taskId: p.taskId,
            runId,
            agentId: p.agent.id,
            toolCallId: call.id,
          });
          const risk = this.deps.tools.get(call.name)?.risk;
          let content: string;
          let isError = false;
          if (outcome.status === "ok") {
            content = JSON.stringify(outcome.output ?? null);
          } else if (outcome.status === "approval_required") {
            approvalIds.push(outcome.approvalId);
            content = JSON.stringify({
              status: "submitted_for_approval",
              approvalId: outcome.approvalId,
              note: "Not executed yet. Aamir will approve or reject it in the Approval Center. Do not retry.",
            });
          } else {
            isError = true;
            content = JSON.stringify({ error: outcome.code, message: outcome.message });
          }
          if (content.length > MAX_TOOL_RESULT_CHARS) content = `${content.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]`;
          results.push({ toolCallId: call.id, content, isError });
          await record("tool", { toolCallId: call.id, input: call.input, outcome: outcome.status, content }, {
            toolName: call.name,
            toolCallId: call.id,
            toolRisk: risk,
            latencyMs: Date.now() - t1,
            isError,
            preview: `${call.name}: ${outcome.status}`,
          });
        }
        if (!done) messages.push({ role: "tool_results", results });
      }

      if (!done) throw new RunFailure("MAX_STEPS", `Stopped after ${p.agent.maxSteps} steps without finishing.`);
      result = { runId, status: approvalIds.length ? "WAITING_APPROVAL" : "COMPLETED", text: finalText, output, approvalIds };
    } catch (e) {
      const { code, message } = this.classify(e);
      result = { runId, status: code === "CANCELLED" ? "CANCELLED" : "FAILED", text: finalText, approvalIds, errorCode: code, errorMessage: message };
    }

    const latencyMs = Date.now() - started;
    await db
      .update(schema.agentRuns)
      .set({
        status: result.status,
        model: servedModel,
        output: { text: result.text, result: result.output ?? null, approvalIds: result.approvalIds },
        latencyMs,
        inputTokens: usage.input,
        outputTokens: usage.output,
        costMicroUsd: p.provider.isMock ? 0 : estimateCostMicroUsd(servedModel, usage.input, usage.output),
        toolCallCount,
        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
        finishedAt: new Date(),
      })
      .where(eq(schema.agentRuns.id, runId));
    await events.publish({ type: "run.finished", taskId: p.taskId, runId, status: result.status, errorCode: result.errorCode ?? null });
    log[result.status === "FAILED" ? "warn" : "info"](
      {
        status: result.status,
        latencyMs,
        inputTokens: usage.input,
        outputTokens: usage.output,
        toolCalls: toolCallCount,
        approvals: approvalIds.length,
        errorCode: result.errorCode,
      },
      "agent run finished",
    );
    return result;
  }

  private async assertNotCancelled(taskId: string) {
    const [t] = await this.deps.db.select({ status: schema.agentTasks.status }).from(schema.agentTasks).where(eq(schema.agentTasks.id, taskId));
    if (t?.status === "CANCELLED") throw new RunFailure("CANCELLED", "Task was cancelled.");
  }

  /** Maps errors to stable codes. Never includes credentials or raw request bodies. */
  private classify(e: unknown): { code: string; message: string } {
    if (e instanceof RunFailure) return { code: e.code, message: e.message };
    if (e instanceof Anthropic.AuthenticationError) return { code: "PROVIDER_AUTH", message: "The model API key was rejected. Check ANTHROPIC_API_KEY." };
    if (e instanceof Anthropic.RateLimitError) return { code: "PROVIDER_RATE_LIMIT", message: "The model provider is rate-limiting requests. Try again shortly." };
    if (e instanceof Anthropic.BadRequestError) return { code: "PROVIDER_BAD_REQUEST", message: `The model provider rejected the request: ${e.message}` };
    if (e instanceof Anthropic.APIConnectionError) return { code: "PROVIDER_UNREACHABLE", message: "Could not reach the model provider." };
    if (e instanceof Anthropic.APIError) return { code: "PROVIDER_ERROR", message: `Model provider error (${e.status ?? "unknown"}).` };
    return { code: "INTERNAL", message: (e as Error)?.message ?? "Unknown error" };
  }
}
