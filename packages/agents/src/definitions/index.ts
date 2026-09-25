import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentId } from "@acc/shared";
import { stepResultSchema, synthesisSchema } from "../orchestration/schemas.js";
import type { AgentDefinition } from "./types.js";

const PROMPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../agents");
const read = (path: string) => readFileSync(resolve(PROMPTS_DIR, path), "utf8").trim();
const SHARED = read("_shared.md");

function specialist(
  id: AgentId,
  description: string,
  opts: { limitations?: string; effort?: AgentDefinition["effort"]; tools?: string[] } = {},
): AgentDefinition {
  return {
    id,
    description,
    limitations: opts.limitations,
    systemPrompt: `${read(`${id}/prompt.md`)}\n\n${SHARED}`,
    effort: opts.effort ?? "medium",
    tools: opts.tools ?? ["kb.search"],
    maxSteps: 6,
    outputSchema: stepResultSchema,
  };
}

/** Planner: classifies the request and writes the plan (schema is built per request in orchestrate). */
export const orchestrator: AgentDefinition = {
  id: "orchestrator",
  description: "Understands the request, plans, delegates to specialists, verifies and summarises.",
  systemPrompt: read("orchestrator/prompt.md"),
  effort: "high",
  tools: ["kb.search", "memory.propose"],
  maxSteps: 6,
};

/** Reviewer: verifies step results against acceptance criteria, detects conflicts, summarises. */
export const orchestratorReview: AgentDefinition = {
  id: "orchestrator",
  description: "Review and summary step of the Orchestrator.",
  systemPrompt: read("orchestrator/synthesize.md"),
  effort: "medium",
  tools: ["kb.search"],
  maxSteps: 4,
  outputSchema: synthesisSchema,
};

export const SPECIALISTS: Partial<Record<AgentId, AgentDefinition>> = {
  sales: specialist("sales", "Lead qualification, sales conversation analysis, course recommendation, follow-up drafts, lead scoring.", {
    limitations: "No CRM access yet (Milestone 5): works only with information in the request or earlier steps.",
  }),
  whatsapp: specialist("whatsapp", "Classifies WhatsApp conversations, identifies intent, flags hot leads, drafts replies.", {
    limitations: "Not connected to WhatsApp yet (Milestone 5): drafts replies from conversation text provided; cannot read or send messages.",
  }),
  content: specialist("content", "Content ideas, hooks, scripts, captions, social posts, Reel concepts, scene plans, AI image/video prompts, content calendars (Urdu, Roman Urdu, English).", {
    effort: "high",
  }),
  research: specialist("research", "Researches AI tools, models, agentic AI, MCP and automation; verifies claims; turns findings into teaching material.", {
    effort: "high",
    limitations: "No web access yet (Milestone 8): cannot see today's news or fetch sources; all time-sensitive claims come back unverified.",
  }),
  student: specialist("student", "Student profiles, enrolment, progress, attendance, assignments, recordings, reminders, certificates, support.", {
    limitations: "No student records yet (Milestone 6): drafts communications and answers policy questions from approved knowledge.",
  }),
  marketing: specialist("marketing", "Campaign analysis, ad copy, hooks, creative ideas, audience hypotheses, performance summaries.", {
    limitations: "No ad account data yet (Milestone 12): analyses only numbers provided; never changes campaigns or budgets.",
  }),
  analytics: specialist("analytics", "Revenue, lead, conversion, course, content, campaign and agent analytics; daily/weekly reports.", {
    limitations: "No database queries yet (Milestone 12): works only with figures provided in the request or earlier steps.",
  }),
  course: specialist("course", "Course structure, lesson plans, teaching material, assignments, quizzes, course documentation, learning support.", {
    effort: "high",
  }),
};

export const AGENTS: Partial<Record<AgentId, AgentDefinition>> = { orchestrator, ...SPECIALISTS };

export type { AgentDefinition } from "./types.js";
