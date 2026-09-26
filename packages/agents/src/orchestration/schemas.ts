import { z } from "zod";
import { CONTENT_LANGUAGES, type AgentId } from "@acc/shared";

export const MAX_PLAN_STEPS = 6;

/** Built per request so the planner can only choose agents that exist. */
export function planSchema<T extends AgentId>(agentIds: readonly [T, ...T[]]) {
  return z
    .object({
      intent: z.string().min(3).max(300).describe("One sentence: what Aamir wants."),
      language: z.enum(CONTENT_LANGUAGES).describe("Output language: ur (Urdu script), ur-roman (Roman Urdu) or en."),
      directAnswer: z
        .string()
        .max(8000)
        .optional()
        .describe("Only when no specialist is needed: the complete answer. Leave steps empty."),
      steps: z
        .array(
          z.object({
            agent: z.enum(agentIds),
            instruction: z.string().min(10).max(2000),
            acceptance: z.string().min(5).max(600).describe("What the result must contain to count as done."),
            dependsOn: z.array(z.number().int().min(1)).max(MAX_PLAN_STEPS).describe("1-based numbers of EARLIER steps whose output this step needs."),
          }),
        )
        .max(MAX_PLAN_STEPS),
    })
    .superRefine((plan, ctx) => {
      if (plan.steps.length === 0 && !plan.directAnswer?.trim()) {
        ctx.addIssue({ code: "custom", path: ["steps"], message: "Provide at least one step, or a directAnswer." });
      }
      plan.steps.forEach((s, i) => {
        for (const d of s.dependsOn) {
          if (d >= i + 1) {
            ctx.addIssue({ code: "custom", path: ["steps", i, "dependsOn"], message: `Step ${i + 1} can only depend on earlier steps (got ${d}).` });
          }
        }
      });
    });
}
export type Plan = z.infer<ReturnType<typeof planSchema<AgentId>>>;

export const stepResultSchema = z.object({
  summary: z.string().min(1).max(1200),
  output: z.string().min(1).max(30_000).describe("The full deliverable in Markdown."),
  sources: z.array(z.object({ title: z.string().max(300), url: z.string().url() })).max(30).default([]),
  unverifiedClaims: z.array(z.string().max(500)).max(50).default([]),
  blockers: z.array(z.string().max(500)).max(20).default([]),
});
export type StepResult = z.infer<typeof stepResultSchema>;

export const synthesisSchema = z.object({
  answer: z.string().min(1).max(30_000).describe("Final result for Aamir: the deliverable first, in the plan's language."),
  issues: z.array(z.string().max(600)).max(30).default([]).describe("Failed/skipped steps, unmet criteria, conflicts, unverified claims."),
  nextSteps: z.array(z.string().max(400)).max(15).default([]),
});
export type Synthesis = z.infer<typeof synthesisSchema>;
