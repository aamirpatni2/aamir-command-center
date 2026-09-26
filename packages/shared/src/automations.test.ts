import { describe, expect, it } from "vitest";
import { AUTOMATION_TEMPLATES, evaluateConditions, renderTemplate, ruleDefinitionSchema } from "./automations.js";

describe("conditions", () => {
  const ctx = { "lead.band": "hot", "lead.score": 72, "message.text": "Fee kitni hai?", "contact.name": null, "lead.new": true };

  it("all conditions must hold (AND)", () => {
    expect(evaluateConditions([{ field: "lead.band", op: "eq", value: "HOT" }, { field: "lead.score", op: "gte", value: 60 }], ctx).matched).toBe(true);
    const r = evaluateConditions([{ field: "lead.band", op: "eq", value: "hot" }, { field: "lead.score", op: "gt", value: 80 }], ctx);
    expect(r.matched).toBe(false);
    expect(r.results.map((x) => x.ok)).toEqual([true, false]);
  });

  it("supports in / contains / exists / not_exists / neq", () => {
    expect(evaluateConditions([{ field: "lead.band", op: "in", value: ["warm", "hot"] }], ctx).matched).toBe(true);
    expect(evaluateConditions([{ field: "lead.band", op: "in", value: "warm, hot" }], ctx).matched).toBe(true);
    expect(evaluateConditions([{ field: "message.text", op: "contains", value: "fee" }], ctx).matched).toBe(true);
    expect(evaluateConditions([{ field: "contact.name", op: "not_exists" }], ctx).matched).toBe(true);
    expect(evaluateConditions([{ field: "contact.name", op: "exists" }], ctx).matched).toBe(false);
    expect(evaluateConditions([{ field: "lead.band", op: "neq", value: "cold" }], ctx).matched).toBe(true);
    expect(evaluateConditions([{ field: "lead.new", op: "eq", value: true }], ctx).matched).toBe(true);
  });

  it("a missing value never matches a comparison", () => {
    expect(evaluateConditions([{ field: "contact.name", op: "neq", value: "Ali" }], ctx).matched).toBe(false);
    expect(evaluateConditions([{ field: "lead.status", op: "eq", value: "new" }], ctx).matched).toBe(false);
  });
});

describe("templates", () => {
  it("fills fields and fallbacks, and does nothing else", () => {
    expect(renderTemplate("Hi {{contact.name|there}}, score {{ lead.score }}", { "contact.name": null, "lead.score": 72 })).toBe("Hi there, score 72");
    expect(renderTemplate("{{constructor}} {{__proto__}} {{x.y}}", {})).toBe("  ");
    expect(renderTemplate("{{message.text}}", { "message.text": "a".repeat(600) })).toHaveLength(501);
  });
});

describe("rule validation", () => {
  const base = { name: "Rule", actions: [{ type: "lead.update", followUpInHours: 2 }] } as const;

  it("accepts the starter templates", () => {
    for (const t of AUTOMATION_TEMPLATES) expect(ruleDefinitionSchema.safeParse(t.definition).success, t.id).toBe(true);
  });

  it("rejects fields the trigger doesn't provide", () => {
    const r = ruleDefinitionSchema.safeParse({ ...base, trigger: { event: "payment.verified" }, actions: [{ type: "agent_task", agent: "student", instruction: "x" }], conditions: [{ field: "lead.band", op: "eq", value: "hot" }] });
    expect(r.success).toBe(false);
  });

  it("rejects lead / WhatsApp actions on triggers without a lead or conversation", () => {
    expect(ruleDefinitionSchema.safeParse({ ...base, trigger: { event: "schedule", cron: "0 8 * * *" } }).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ ...base, trigger: { event: "schedule", cron: "0 8 * * *" }, actions: [{ type: "whatsapp.draft", text: "hi" }] }).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ ...base, trigger: { event: "lead.created" } }).success).toBe(true);
  });

  it("automations can never mark a lead won or lost", () => {
    for (const status of ["won", "lost"]) {
      expect(ruleDefinitionSchema.safeParse({ ...base, trigger: { event: "lead.created" }, actions: [{ type: "lead.update", status }] }).success).toBe(false);
    }
  });

  it("comparisons need a value; rules are created switched off by default", () => {
    expect(ruleDefinitionSchema.safeParse({ ...base, trigger: { event: "lead.created" }, conditions: [{ field: "lead.band", op: "eq" }] }).success).toBe(false);
    const ok = ruleDefinitionSchema.parse({ ...base, trigger: { event: "lead.created" } });
    expect(ok.enabled).toBe(false);
    expect(ok.maxRunsPerHour).toBe(30);
  });
});
