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
import { whatsappSend, whatsappSendTemplate } from "../tools/crm.js";
import { calendarEventInput } from "../tools/workspace.js";
import { findApprovedTemplate, renderTemplateBody } from "../integrations/whatsapp/templates.js";
import { IntegrationError, type OAuthService } from "../integrations/oauth/service.js";
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
  oauth?: OAuthService | null;
  now?: () => Date;
}

export interface ExecutableApproval {
  id: string;
  payload: Record<string, unknown>;
  editedPayload: Record<string, unknown> | null;
}

export interface Executor {
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

/** Sends an approved template: no 24-hour limit, but the template must be APPROVED and the params must fit. */
async function sendTemplate(deps: ExecutorDeps, p: { conversationId: string; template: string; language: string; params: string[] }): Promise<ExecutionOutcome> {
  const { db, whatsapp } = deps;
  const t = await findApprovedTemplate(db, p.template, p.language);
  if (!t) return notExecuted("PRECONDITION", `Template "${p.template}" (${p.language}) isn't an approved, synced template. Sync templates on the Integrations page.`);
  if (p.params.length !== t.bodyParams) return notExecuted("PRECONDITION", `Template "${p.template}" needs ${t.bodyParams} parameter(s); ${p.params.length} given.`);
  const [row] = await db
    .select({ channel: schema.conversations.channel, phone: schema.contacts.phone })
    .from(schema.conversations)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
    .where(eq(schema.conversations.id, p.conversationId));
  if (!row?.phone || row.channel !== "whatsapp") return notExecuted("PRECONDITION", "No WhatsApp conversation with a phone number.");
  const missing = whatsapp.missing();
  if (missing.length) return notExecuted("NOT_CONFIGURED", `WhatsApp sending is not configured. Set ${missing.join(", ")} in .env, then retry.`, { missing });
  let res: Awaited<ReturnType<WhatsAppClient["sendTemplate"]>>;
  try {
    res = await whatsapp.sendTemplate(row.phone, p.template, p.language, p.params);
  } catch (e) {
    return { status: "unknown", message: `WhatsApp request failed before a response arrived (${(e as Error).message}). Check the chat before sending again.` };
  }
  if (res.status === "not_configured") return notExecuted("NOT_CONFIGURED", `WhatsApp sending is not configured. Set ${res.missing.join(", ")} in .env, then retry.`, { missing: res.missing });
  if (res.status === "error") {
    if (res.httpStatus >= 500) return { status: "unknown", message: `WhatsApp returned HTTP ${res.httpStatus}: ${res.message}. Check the chat before sending again.` };
    return notExecuted("PROVIDER_REJECTED", `WhatsApp rejected the template: ${res.message}`, { httpStatus: res.httpStatus, code: res.code });
  }
  const [msg] = await db
    .insert(schema.messages)
    .values({ conversationId: p.conversationId, direction: "outbound", providerMessageId: res.providerMessageId, body: renderTemplateBody(t.body, p.params), status: "sent", sentBy: "agent" })
    .onConflictDoNothing()
    .returning({ id: schema.messages.id });
  await db.update(schema.conversations).set({ lastMessageAt: new Date() }).where(eq(schema.conversations.id, p.conversationId));
  return { status: "executed", result: { providerMessageId: res.providerMessageId, messageId: msg?.id ?? null, template: p.template } };
}

const EXECUTORS: Record<string, Executor> = {
  [whatsappSendTemplate.name]: {
    tool: whatsappSendTemplate,
    run: (p: { conversationId: string; template: string; language: string; params: string[] }, deps) => sendTemplate(deps, p),
  },
  "google.calendar.create_event": {
    tool: { name: "google.calendar.create_event", description: "", risk: "external", input: calendarEventInput, editableFields: ["summary", "description", "start", "end", "location"], run: async () => null },
    async run(p: { summary: string; description?: string; start: string; end: string; attendees: string[]; location?: string }, deps) {
      if (!deps.oauth) return notExecuted("NOT_CONFIGURED", "Google isn't configured on this server.");
      try {
        const e = await deps.oauth.request<{ id: string; htmlLink?: string }>("google", "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
          method: "POST",
          body: JSON.stringify({
            summary: p.summary,
            description: p.description,
            location: p.location,
            start: { dateTime: p.start, timeZone: "Asia/Karachi" },
            end: { dateTime: p.end, timeZone: "Asia/Karachi" },
            attendees: p.attendees.map((email) => ({ email })),
          }),
        });
        return { status: "executed", result: { eventId: e.id, link: e.htmlLink ?? null } };
      } catch (e) {
        if (e instanceof IntegrationError && (e.code === "NOT_CONFIGURED" || e.code === "NOT_CONNECTED")) return notExecuted("NOT_CONFIGURED", e.message);
        const status = (e as { httpStatus?: number }).httpStatus;
        if (status && status < 500) return notExecuted("PROVIDER_REJECTED", (e as Error).message);
        return { status: "unknown", message: `Google request failed: ${(e as Error).message}. Check the calendar before retrying.` };
      }
    },
  },
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

/** Executors added at runtime (e.g. approval-gated MCP tools from mcp.config.json). */
const DYNAMIC = new Map<string, Executor>();

export function registerExecutor(toolName: string, executor: Executor) {
  DYNAMIC.set(toolName, executor);
}

export function executorFor(toolName: string): Executor | undefined {
  return EXECUTORS[toolName] ?? DYNAMIC.get(toolName);
}

/** Tools whose approvals can be executed. Anything else is recorded as NO_EXECUTOR, never faked. */
export const EXECUTABLE_TOOLS = () => [...Object.keys(EXECUTORS), ...DYNAMIC.keys()];

export async function runApprovedAction(toolName: string, approval: ExecutableApproval, deps: ExecutorDeps): Promise<ExecutionOutcome> {
  const executor = executorFor(toolName);
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
