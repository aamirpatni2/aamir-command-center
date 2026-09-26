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
  sales: specialist("sales", "Lead qualification and pipeline: searches and reads leads and their conversations, explains scores, recommends courses, schedules follow-ups, updates lead status and notes.", {
    tools: ["kb.search", "course.catalog", "crm.lead.search", "crm.lead.get", "crm.lead.update", "google.calendar.list_events", "google.gmail.create_draft"],
  }),
  whatsapp: specialist("whatsapp", "Reads WhatsApp conversations, classifies intent, flags hot leads, drafts replies (sent only after approval), updates the lead and schedules follow-ups.", {
    tools: ["kb.search", "course.catalog", "conversation.read", "crm.lead.update", "whatsapp.send", "whatsapp.templates", "whatsapp.send_template"],
    limitations: "Approved messages are sent only when WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are configured. Outside the 24-hour window only approved templates can be sent (synced from WhatsApp Manager).",
  }),
  content: specialist("content", "Creates and saves content drafts: topic ideas, hooks, YouTube scripts, Facebook Reel scripts, captions, posts, carousels, AI image/video prompts and repurposing plans (Roman Urdu, Urdu, English), in Aamir's voice.", {
    effort: "high",
    tools: ["kb.search", "course.catalog", "content.search", "content.save", "google.drive.search", "canva.designs.list", "canva.designs.create"],
  }),
  research: specialist("research", "Researches AI tools, models, agentic AI, MCP and automation on the live web; verifies each claim against sources it actually opened; saves research reports; turns findings into teaching material.", {
    effort: "high",
    tools: ["web.search", "web.fetch", "kb.search", "research.save", "google.drive.search"],
    limitations: "Live web research needs BRAVE_API_KEY or TAVILY_API_KEY; without it the web tools report not_configured and every time-sensitive claim stays unverified.",
  }),
  student: specialist("student", "Student records: enrolment, attendance, assignments, payments and balances, recordings, reminders, certificate eligibility, support.", {
    tools: ["kb.search", "course.catalog", "student.search", "student.get", "student.message", "certificate.request", "google.calendar.list_events", "google.calendar.create_event", "google.gmail.create_draft"],
    limitations: "Messages, certificates and calendar invites go to approval. Messages need WhatsApp credentials and reach only students who wrote in the last 24 hours; Calendar and Gmail need Google connected.",
  }),
  marketing: specialist("marketing", "Campaign analysis, ad copy, hooks, creative ideas, audience hypotheses, performance summaries.", {
    tools: ["kb.search", "course.catalog", "canva.designs.list", "canva.designs.create", "google.gmail.create_draft"],
    limitations: "No ad account data yet (Milestone 12): analyses only numbers provided; never changes campaigns or budgets.",
  }),
  analytics: specialist("analytics", "Revenue, lead, conversion, course, content, campaign and agent analytics; daily/weekly reports.", {
    limitations: "No database queries yet (Milestone 12): works only with figures provided in the request or earlier steps.",
  }),
  course: specialist("course", "Course structure, lesson plans, teaching material, assignments, quizzes, course documentation, learning support.", {
    effort: "high",
    tools: ["kb.search", "course.catalog", "google.drive.search", "google.calendar.list_events"],
  }),
};

export const AGENTS: Partial<Record<AgentId, AgentDefinition>> = { orchestrator, ...SPECIALISTS };

export type { AgentDefinition } from "./types.js";
