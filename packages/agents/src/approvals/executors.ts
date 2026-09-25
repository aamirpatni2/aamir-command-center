/**
 * Runs APPROVED actions. Each executor re-validates the stored payload with the tool's own schema,
 * checks preconditions at execution time (not at request time), and reports one of three outcomes:
 *
 * - executed      — the action happened.
 * - not_executed  — nothing reached the outside world; safe to retry once the cause is fixed.
 * - unknown       — the request may have reached the provider (network error, timeout, 5xx);
 *                   never retried automatically, because a retry could send twice.
 */
import { and, desc, eq, issueCertificate, schema, sql, type Database } from "@acc/database";
import { CUSTOMER_SERVICE_WINDOW_MS, type WhatsAppClient } from "../integrations/whatsapp/client.js";
import { whatsappSend } from "../tools/crm.js";
import { certificateRequest, studentMessage } from "../tools/education.js";
import type { Tool } from "../tools/types.js";

export type NotExecutedCode = "NOT_CONFIGURED" | "OUTSIDE_WINDOW" | "PRECONDITION" | "PROVIDER_REJECTED" | "NO_EXECUTOR";

export type ExecutionOutcome =
  | { status: "executed"; result: Record<string, unknown> }
  | { status: "not_executed"; code: NotExecutedCode; message: string; details?: unknown }
  | { status: "unknown"; message: string };

export interface ExecutorDeps {
  db: Database;
  whatsapp: WhatsAppClient;
  now?: () => Date;
}

export interface ExecutableApproval {
  id: string;
  payload: Record<string, unknown>;
  editedPayload: Record<string, unknown> | null;
}

interface Executor {
  tool: Tool<any, any>;
  run(payload: any, deps: ExecutorDeps, ctx: { edited: boolean }): Promise<ExecutionOutcome>;
}

const notExecuted = (code: NotExecutedCode, message: string, details?: unknown): ExecutionOutcome => ({ status: "not_executed", code, message, details });

/** Sends free text in an existing WhatsApp conversation, enforcing Meta's 24-hour customer-service window. */
async function sendInConversation(deps: ExecutorDeps, conversationId: string, text: string, sentBy: "agent" | "user"): Promise<ExecutionOutcome> {
  const { db, whatsapp } = deps;
  const now = deps.now?.() ?? new Date();
  const [row] = await db
    .select({ channel: schema.conversations.channel, phone: schema.contacts.phone })
    .from(schema.conversations)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
    .where(eq(schema.conversations.id, conversationId));
  if (!row) return notExecuted("PRECONDITION", "The conversation no longer exists.");
  if (row.channel !== "whatsapp") return notExecuted("PRECONDITION", `This conversation is on ${row.channel}, not WhatsApp.`);
  if (!row.phone) return notExecuted("PRECONDITION", "The contact has no phone number.");

  const [last] = await db
    .select({ at: schema.messages.createdAt })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.direction, "inbound")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  if (!last || now.getTime() - last.at.getTime() > CUSTOMER_SERVICE_WINDOW_MS) {
    return notExecuted(
      "OUTSIDE_WINDOW",
      "Outside WhatsApp's 24-hour window: free-text messages only deliver within 24 hours of the customer's last message. Approved message templates arrive with the integrations milestone.",
      { lastInboundAt: last?.at ?? null },
    );
  }

  const missing = whatsapp.missing();
  if (missing.length) return notExecuted("NOT_CONFIGURED", `WhatsApp sending is not configured. Set ${missing.join(", ")} in .env, then retry.`, { missing });

  let res: Awaited<ReturnType<WhatsAppClient["sendText"]>>;
  try {
    res = await whatsapp.sendText(row.phone, text);
  } catch (e) {
    return { status: "unknown", message: `WhatsApp request failed before a response arrived (${(e as Error).message}). Check the chat on your phone before sending again.` };
  }
  if (res.status === "not_configured") return notExecuted("NOT_CONFIGURED", `WhatsApp sending is not configured. Set ${res.missing.join(", ")} in .env, then retry.`, { missing: res.missing });
  if (res.status === "error") {
    // 4xx = Meta rejected the request (nothing sent). 5xx = unclear whether it was processed.
    if (res.httpStatus >= 500) return { status: "unknown", message: `WhatsApp returned HTTP ${res.httpStatus}: ${res.message}. Check the chat before sending again.` };
    return notExecuted("PROVIDER_REJECTED", `WhatsApp rejected the message: ${res.message}`, { httpStatus: res.httpStatus, code: res.code });
  }

  const [msg] = await db
    .insert(schema.messages)
    .values({ conversationId, direction: "outbound", providerMessageId: res.providerMessageId, body: text, status: "sent", sentBy })
    .onConflictDoNothing()
    .returning({ id: schema.messages.id });
  await db.update(schema.conversations).set({ lastMessageAt: now }).where(eq(schema.conversations.id, conversationId));
  return { status: "executed", result: { providerMessageId: res.providerMessageId, messageId: msg?.id ?? null, conversationId } };
}

const EXECUTORS: Record<string, Executor> = {
  [whatsappSend.name]: {
    tool: whatsappSend,
    run: (p: { conversationId: string; text: string }, deps, { edited }) => sendInConversation(deps, p.conversationId, p.text, edited ? "user" : "agent"),
  },
  [studentMessage.name]: {
    tool: studentMessage,
    async run(p: { studentId: string; text: string }, deps, { edited }) {
      const [conv] = await deps.db
        .select({ id: schema.conversations.id })
        .from(schema.students)
        .innerJoin(schema.conversations, and(eq(schema.conversations.contactId, schema.students.contactId), eq(schema.conversations.channel, "whatsapp")))
        .where(eq(schema.students.id, p.studentId))
        .orderBy(sql`${schema.conversations.lastMessageAt} desc nulls last`)
        .limit(1);
      if (!conv) {
        return notExecuted(
          "OUTSIDE_WINDOW",
          "This student has never messaged on WhatsApp, so a free-text message can't be delivered. Approved message templates arrive with the integrations milestone.",
        );
      }
      return sendInConversation(deps, conv.id, p.text, edited ? "user" : "agent");
    },
  },
  [certificateRequest.name]: {
    tool: certificateRequest,
    async run(p: { enrollmentId: string }, deps) {
      const r = await issueCertificate(deps.db, p.enrollmentId);
      switch (r.status) {
        case "issued":
          return { status: "executed", result: { enrollmentId: p.enrollmentId, certificateStatus: "issued" } };
        case "already_issued":
          return { status: "executed", result: { enrollmentId: p.enrollmentId, certificateStatus: "issued", alreadyIssued: true } };
        case "not_found":
          return notExecuted("PRECONDITION", "The enrollment no longer exists.");
        case "not_eligible":
          return notExecuted("PRECONDITION", `Not eligible yet: ${r.failing.map((c) => c.rule).join("; ")}.`, { failing: r.failing });
      }
    },
  },
};

export function executorFor(toolName: string): Executor | undefined {
  return EXECUTORS[toolName];
}

/** Tools whose approvals can be executed. Anything else is recorded as NO_EXECUTOR, never faked. */
export const EXECUTABLE_TOOLS = Object.keys(EXECUTORS);

export async function runApprovedAction(toolName: string, approval: ExecutableApproval, deps: ExecutorDeps): Promise<ExecutionOutcome> {
  const executor = EXECUTORS[toolName];
  if (!executor) return notExecuted("NO_EXECUTOR", `No executor is available for ${toolName} yet.`);
  const parsed = executor.tool.input.safeParse(approval.editedPayload ?? approval.payload);
  if (!parsed.success) return notExecuted("PRECONDITION", `Stored payload is invalid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  try {
    return await executor.run(parsed.data, deps, { edited: approval.editedPayload !== null });
  } catch (e) {
    // An unexpected error after we may have touched the outside world: treat as unknown, never retry blindly.
    return { status: "unknown", message: `Execution failed: ${(e as Error).message}` };
  }
}
