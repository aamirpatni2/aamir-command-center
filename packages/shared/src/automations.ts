/**
 * Automation rules: trigger → conditions → actions. Shared by the API (validation), the worker
 * (execution) and the web UI (builder). Rules can never send or publish on their own: messaging
 * actions create Approval Center requests, and agent actions go through the normal tool policy.
 */
import { z } from "zod";
import { AGENT_IDS } from "./statuses.js";

export interface EventDef {
  label: string;
  description: string;
  /** Context fields available to conditions and {{templates}}. */
  fields: readonly string[];
  kind: "event" | "sweep" | "schedule";
}

const LEAD_FIELDS = ["lead.id", "lead.status", "lead.score", "lead.band", "lead.source", "contact.name", "contact.phone"] as const;

export const AUTOMATION_EVENTS = {
  "whatsapp.message_received": {
    label: "WhatsApp message received",
    description: "A lead or student writes on WhatsApp.",
    fields: [...LEAD_FIELDS, "conversation.id", "message.text", "lead.new"],
    kind: "event",
  },
  "lead.created": {
    label: "New lead",
    description: "A new lead is created (WhatsApp enquiry or added by hand).",
    fields: [...LEAD_FIELDS, "conversation.id"],
    kind: "event",
  },
  "payment.verified": {
    label: "Payment verified",
    description: "The owner or an admin verifies a payment.",
    fields: ["payment.id", "payment.amount", "payment.method", "student.id", "contact.name", "contact.phone", "course.title", "batch.name", "enrollment.id"],
    kind: "event",
  },
  "lead.no_reply": {
    label: "Lead hasn't replied (we spoke last)",
    description: "Our last WhatsApp message has had no answer for the chosen number of hours.",
    fields: [...LEAD_FIELDS, "conversation.id", "hours.silent"],
    kind: "sweep",
  },
  "lead.inactive": {
    label: "No activity with a lead",
    description: "Nobody has written in either direction for the chosen number of days.",
    fields: [...LEAD_FIELDS, "conversation.id", "days.inactive"],
    kind: "sweep",
  },
  schedule: {
    label: "On a schedule",
    description: "At fixed times (Pakistan time), e.g. every morning at 7:45.",
    fields: ["now.date", "now.weekday"],
    kind: "schedule",
  },
} as const satisfies Record<string, EventDef>;

export type AutomationEvent = keyof typeof AUTOMATION_EVENTS;
export const AUTOMATION_EVENT_IDS = Object.keys(AUTOMATION_EVENTS) as AutomationEvent[];

export const CONDITION_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "exists", "not_exists"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export const CONDITION_OP_LABEL: Record<ConditionOp, string> = {
  eq: "is", neq: "is not", gt: ">", gte: "≥", lt: "<", lte: "≤", in: "is one of", contains: "contains", exists: "is set", not_exists: "is empty",
};

/** 5-field cron. Detailed validation (and the minimum interval) happens server-side. */
const CRON = /^\s*(\S+\s+){4}\S+\s*$/;
export const AUTOMATION_TZ = "Asia/Karachi";
export const MIN_SCHEDULE_INTERVAL_MINUTES = 15;

export const triggerSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("whatsapp.message_received") }),
  z.object({ event: z.literal("lead.created") }),
  z.object({ event: z.literal("payment.verified") }),
  z.object({ event: z.literal("lead.no_reply"), hours: z.number().int().min(1).max(720) }),
  z.object({ event: z.literal("lead.inactive"), days: z.number().int().min(1).max(90) }),
  z.object({ event: z.literal("schedule"), cron: z.string().regex(CRON, "Use 5 cron fields, e.g. 45 7 * * *"), tz: z.literal(AUTOMATION_TZ).default(AUTOMATION_TZ) }),
]);
export type AutomationTrigger = z.infer<typeof triggerSchema>;

export const conditionSchema = z.object({
  field: z.string().min(1).max(60),
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(100)).max(20)]).optional(),
});
export type AutomationCondition = z.infer<typeof conditionSchema>;

const template = (max: number) => z.string().trim().min(1).max(max);
export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent_task"),
    /** "orchestrator" plans across agents; a specialist gets the instruction directly (cheaper). */
    agent: z.enum(AGENT_IDS),
    instruction: template(2000),
  }),
  z.object({
    type: z.literal("lead.update"),
    // Won/lost are decisions a person makes; automations never set them.
    status: z.enum(["new", "contacted", "qualified", "interested", "negotiating", "nurture"]).optional(),
    appendNote: template(500).optional(),
    followUpInHours: z.number().int().min(0).max(24 * 60).optional(),
  }),
  z.object({
    type: z.literal("whatsapp.draft"),
    /** Always an Approval Center request; never sent without a person approving it. */
    text: template(1000),
  }),
  z.object({
    type: z.literal("whatsapp.template"),
    /** An APPROVED template synced from WhatsApp Manager; works outside the 24-hour window. Still needs approval. */
    template: z.string().trim().min(1).max(512),
    language: z.string().trim().min(2).max(15),
    params: z.array(template(300)).max(10).default([]),
  }),
]);
export type AutomationAction = z.infer<typeof actionSchema>;

export const ACTION_LABEL: Record<AutomationAction["type"], string> = {
  agent_task: "Give an agent a task",
  "lead.update": "Update the lead",
  "whatsapp.draft": "Draft a WhatsApp message (needs approval)",
  "whatsapp.template": "Send a WhatsApp template (needs approval)",
};

/** Actions that need a lead / conversation in the event context. */
export const ACTION_NEEDS: Record<AutomationAction["type"], string | null> = {
  agent_task: null,
  "lead.update": "lead.id",
  "whatsapp.draft": "conversation.id",
  "whatsapp.template": "conversation.id",
};

export const ruleDefinitionSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    trigger: triggerSchema,
    conditions: z.array(conditionSchema).max(8).default([]),
    actions: z.array(actionSchema).min(1).max(5),
    /** Safety valve against floods (a bad condition, a burst of messages). */
    maxRunsPerHour: z.number().int().min(1).max(200).default(30),
    enabled: z.boolean().default(false),
  })
  .superRefine((r, ctx) => {
    const fields: readonly string[] = AUTOMATION_EVENTS[r.trigger.event].fields;
    r.conditions.forEach((c, i) => {
      if (!fields.includes(c.field)) ctx.addIssue({ code: "custom", path: ["conditions", i, "field"], message: `"${c.field}" isn't available for this trigger` });
      if (!["exists", "not_exists"].includes(c.op) && c.value === undefined) ctx.addIssue({ code: "custom", path: ["conditions", i, "value"], message: "A value is required" });
    });
    r.actions.forEach((a, i) => {
      const need = ACTION_NEEDS[a.type];
      if (need && !fields.includes(need)) ctx.addIssue({ code: "custom", path: ["actions", i, "type"], message: `${ACTION_LABEL[a.type]} needs a lead or conversation; this trigger has none` });
    });
  });
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;

// ── Pure helpers (used by the engine and the UI preview) ──────────────────

export type AutomationContext = Record<string, string | number | boolean | null | undefined>;

export interface ConditionResult {
  condition: AutomationCondition;
  actual: unknown;
  ok: boolean;
}

/** Own properties only: `{{constructor}}` or a "__proto__" field must never reach the prototype. */
const lookup = (ctx: AutomationContext, key: string) => (Object.hasOwn(ctx, key) ? ctx[key] : undefined);

export function evaluateConditions(conditions: AutomationCondition[], ctx: AutomationContext): { matched: boolean; results: ConditionResult[] } {
  const results = conditions.map((c) => {
    const actual = lookup(ctx, c.field);
    return { condition: c, actual, ok: evaluateOne(c, actual) };
  });
  return { matched: results.every((r) => r.ok), results };
}

function evaluateOne(c: AutomationCondition, actual: unknown): boolean {
  const empty = actual === null || actual === undefined || actual === "";
  if (c.op === "exists") return !empty;
  if (c.op === "not_exists") return empty;
  if (empty) return false;
  const v = c.value;
  const num = (x: unknown) => (typeof x === "number" ? x : Number(x));
  const str = (x: unknown) => String(x).toLowerCase();
  switch (c.op) {
    case "eq": return str(actual) === str(v);
    case "neq": return str(actual) !== str(v);
    case "gt": return num(actual) > num(v);
    case "gte": return num(actual) >= num(v);
    case "lt": return num(actual) < num(v);
    case "lte": return num(actual) <= num(v);
    case "in": return (Array.isArray(v) ? v : String(v).split(",")).map((x) => str(x).trim()).includes(str(actual));
    case "contains": return str(actual).includes(str(v));
  }
}

/**
 * Fills {{field}} or {{field|fallback}} from the context. Plain substitution only: no expressions,
 * no code. Values are trimmed to 500 characters.
 */
export function renderTemplate(tpl: string, ctx: AutomationContext): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g, (_m, key: string, fallback?: string) => {
    const v = lookup(ctx, key);
    const s = v === null || v === undefined || v === "" ? (fallback ?? "").trim() : String(v);
    return s.length > 500 ? `${s.slice(0, 500)}…` : s;
  });
}

export function describeTrigger(t: AutomationTrigger): string {
  switch (t.event) {
    case "lead.no_reply": return `A lead hasn't replied for ${t.hours} h (we spoke last)`;
    case "lead.inactive": return `No activity with a lead for ${t.days} day${t.days === 1 ? "" : "s"}`;
    case "schedule": return `Schedule: ${t.cron} (Pakistan time)`;
    default: return AUTOMATION_EVENTS[t.event].label;
  }
}

// ── Starter templates (created disabled; the owner reviews and switches them on) ──

export interface AutomationTemplate {
  id: string;
  definition: RuleDefinition;
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "morning-research",
    definition: {
      name: "Morning AI research brief",
      description: "Every morning, the Research Agent collects the day's important AI developments with sources.",
      trigger: { event: "schedule", cron: "45 7 * * *", tz: AUTOMATION_TZ },
      conditions: [],
      actions: [{ type: "agent_task", agent: "research", instruction: "Research today's ({{now.date}}) most important AI developments for Pakistani students, freelancers and small businesses. Verify each claim against the sources you open and save a research report." }],
      maxRunsPerHour: 2,
      enabled: false,
    },
  },
  {
    id: "hot-lead-flag",
    definition: {
      name: "Flag hot WhatsApp leads for a call",
      description: "When a hot lead writes, add a note and schedule a call within 2 hours.",
      trigger: { event: "whatsapp.message_received" },
      conditions: [{ field: "lead.band", op: "eq", value: "hot" }],
      actions: [{ type: "lead.update", appendNote: "Hot lead wrote on WhatsApp: call today.", followUpInHours: 2 }],
      maxRunsPerHour: 30,
      enabled: false,
    },
  },
  {
    id: "quiet-hot-lead",
    definition: {
      name: "Follow up hot leads who went quiet",
      description: "Our reply got no answer for 20 hours: the WhatsApp Agent drafts a gentle follow-up for approval (still inside WhatsApp's 24-hour window).",
      trigger: { event: "lead.no_reply", hours: 20 },
      conditions: [{ field: "lead.band", op: "in", value: ["hot", "warm"] }],
      actions: [{ type: "agent_task", agent: "whatsapp", instruction: "{{contact.name|This lead}} hasn't replied for {{hours.silent}} hours to our last message in conversation {{conversation.id}}. Read the conversation and, if a follow-up makes sense, submit one short, friendly, non-pushy follow-up with whatsapp.send (it goes to approval)." }],
      maxRunsPerHour: 20,
      enabled: false,
    },
  },
  {
    id: "template-reengage",
    definition: {
      name: "Re-engage quiet leads with a template",
      description: "After 3 days without a reply the 24-hour window is closed, so a pre-approved WhatsApp template is prepared for your approval. Set the template name to one you created and synced.",
      trigger: { event: "lead.no_reply", hours: 72 },
      conditions: [{ field: "lead.band", op: "in", value: ["hot", "warm"] }],
      actions: [{ type: "whatsapp.template", template: "follow_up", language: "en", params: ["{{contact.name|there}}"] }],
      maxRunsPerHour: 20,
      enabled: false,
    },
  },
  {
    id: "inactive-warm",
    definition: {
      name: "Remind me about inactive warm leads",
      description: "After 7 days with no activity, put warm leads back on today's follow-up list.",
      trigger: { event: "lead.inactive", days: 7 },
      conditions: [{ field: "lead.band", op: "eq", value: "warm" }],
      actions: [{ type: "lead.update", appendNote: "No activity for {{days.inactive}} days: call or send a template message.", followUpInHours: 0 }],
      maxRunsPerHour: 30,
      enabled: false,
    },
  },
  {
    id: "welcome-student",
    definition: {
      name: "Welcome new students after payment",
      description: "When a payment is verified, the Student Agent drafts a welcome message with the batch details (goes to approval).",
      trigger: { event: "payment.verified" },
      conditions: [],
      actions: [{ type: "agent_task", agent: "student", instruction: "A payment of {{payment.amount}} from {{contact.name|a student}} for {{course.title}} ({{batch.name}}) was just verified (student {{student.id}}). Check their record and submit a warm welcome message with student.message that includes the batch start date and what to prepare." }],
      maxRunsPerHour: 20,
      enabled: false,
    },
  },
];
