import { z } from "zod";
import { and, eq, ne, schema, sql, writeAudit } from "@acc/database";
import { APPROVAL_REQUIRED_RISKS } from "@acc/shared";
import type { ToolSpec } from "../model/types.js";
import type { Tool, ToolContext, ToolOutcome } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The single enforcement point between agents and the outside world:
 * allow-list → input validation → risk policy (approval) → execution with timeout → audit.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool<any, any>>();

  register(...tools: Tool<any, any>[]): this {
    for (const t of tools) {
      if (this.tools.has(t.name)) throw new Error(`Tool ${t.name} registered twice`);
      this.tools.set(t.name, t);
    }
    return this;
  }

  get(name: string) {
    return this.tools.get(name);
  }

  /** Model-facing specs for the tools an agent may use. Unknown names are a config error. */
  specsFor(allowed: readonly string[]): ToolSpec[] {
    return allowed.map((name) => {
      const t = this.tools.get(name);
      if (!t) throw new Error(`Agent is granted unknown tool "${name}"`);
      const jsonSchema = z.toJSONSchema(t.input, { target: "draft-7", io: "input" }) as Record<string, unknown>;
      delete jsonSchema.$schema;
      const note = APPROVAL_REQUIRED_RISKS.includes(t.risk)
        ? " This action needs human approval: calling it submits a request to the Approval Center instead of running immediately."
        : "";
      return { name, description: t.description + note, inputSchema: jsonSchema };
    });
  }

  async execute(allowed: readonly string[], call: { id: string; name: string; input: unknown }, ctx: ToolContext): Promise<ToolOutcome> {
    const tool = this.tools.get(call.name);
    if (!tool) return { status: "error", code: "UNKNOWN_TOOL", message: `Unknown tool "${call.name}"` };
    if (!allowed.includes(call.name)) {
      await writeAudit(ctx.db, {
        actorType: "agent",
        actorId: ctx.agentId,
        action: "tool.denied",
        entityType: "agent_run",
        entityId: ctx.runId,
        metadata: { tool: call.name },
      });
      return { status: "error", code: "NOT_ALLOWED", message: `Tool "${call.name}" is not permitted for the ${ctx.agentId} agent` };
    }

    const parsed = tool.input.safeParse(call.input);
    if (!parsed.success) {
      return {
        status: "error",
        code: "INVALID_INPUT",
        message: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
      };
    }

    if (APPROVAL_REQUIRED_RISKS.includes(tool.risk)) {
      // Idempotent per tool call: a retried step never creates a second approval.
      const idempotencyKey = `${ctx.runId}:${call.id}`;
      const [row] = await ctx.db
        .insert(schema.approvals)
        .values({
          taskId: ctx.taskId,
          runId: ctx.runId,
          actionType: tool.risk,
          toolName: tool.name,
          risk: tool.risk,
          title: tool.describe ? tool.describe(parsed.data) : `${ctx.agentId} agent wants to run ${tool.name}`,
          payload: parsed.data as Record<string, unknown>,
          requestedByAgent: ctx.agentId,
          idempotencyKey,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
        })
        .onConflictDoUpdate({ target: schema.approvals.idempotencyKey, set: { updatedAt: new Date() } })
        .returning({ id: schema.approvals.id });
      if (tool.supersedeKey) {
        const key = tool.supersedeKey(parsed.data);
        const superseded = await ctx.db
          .update(schema.approvals)
          .set({ status: "expired", decisionNote: "Superseded by a newer draft", decidedAt: new Date() })
          .where(
            and(
              eq(schema.approvals.status, "pending"),
              eq(schema.approvals.toolName, tool.name),
              ne(schema.approvals.id, row!.id),
              sql`${schema.approvals.payload}->>${key.field} = ${key.value}`,
            ),
          )
          .returning({ id: schema.approvals.id });
        for (const s of superseded) {
          await writeAudit(ctx.db, { actorType: "agent", actorId: ctx.agentId, action: "approval.superseded", entityType: "approval", entityId: s.id, metadata: { by: row!.id } });
        }
      }
      await writeAudit(ctx.db, {
        actorType: "agent",
        actorId: ctx.agentId,
        action: "approval.requested",
        entityType: "approval",
        entityId: row!.id,
        metadata: { tool: tool.name, risk: tool.risk, taskId: ctx.taskId },
      });
      return { status: "approval_required", approvalId: row!.id };
    }

    const timeoutMs = tool.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    try {
      const output = await Promise.race([
        tool.run(parsed.data, ctx),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error(`timed out after ${timeoutMs}ms`), { code: "TIMEOUT" })), timeoutMs);
        }),
      ]);
      if (tool.risk === "write") {
        await writeAudit(ctx.db, { actorType: "agent", actorId: ctx.agentId, action: `tool.${tool.name}`, entityType: "agent_run", entityId: ctx.runId });
      }
      return { status: "ok", output };
    } catch (e) {
      const err = e as Error & { code?: string };
      return err.code === "TIMEOUT"
        ? { status: "error", code: "TIMEOUT", message: `Tool ${tool.name} ${err.message}` }
        : { status: "error", code: "FAILED", message: `Tool ${tool.name} failed: ${err.message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
