/**
 * Routing eval: does the real planner pick the right specialists?
 * Runs ONLY the planning call per case (no specialist runs) against the configured model.
 * Costs real API credits (~12 planner calls). Usage: pnpm eval:routing
 */
import pino from "pino";
import { loadEnv } from "@acc/config";
import { AnthropicProvider } from "../src/model/anthropic.js";
import { orchestrator, SPECIALISTS } from "../src/definitions/index.js";
import { planSchema, type Plan } from "../src/orchestration/schemas.js";
import { agentCatalogue } from "../src/orchestration/orchestrate.js";
import { z } from "zod";
import type { AgentId } from "@acc/shared";

interface Case {
  request: string;
  /** Agents that must appear in the plan. */
  expect: AgentId[];
  /** Agents that must not appear. */
  forbid?: AgentId[];
  /** true when a direct answer (no steps) is acceptable/expected. */
  direct?: boolean;
}

const CASES: Case[] = [
  { request: "Find today's important AI developments and turn them into three Reel ideas.", expect: ["research", "content"] },
  { request: "Ek naye lead ne WhatsApp pe poocha hai ke fees kitni hai aur class kab start hogi. Reply draft kar do.", expect: ["whatsapp"], forbid: ["marketing"] },
  { request: "Here are 20 leads from last week's campaign with their messages. Which ones are hot and what follow-up should each get?", expect: ["sales"] },
  { request: "Write 5 Facebook post hooks in Roman Urdu for the early-bird offer.", expect: ["content"], forbid: ["research"] },
  { request: "Our CTR is 0.8%, CPC PKR 18, 42 leads from PKR 25,000 spend. Analyse the campaign and suggest 3 new ad angles.", expect: ["marketing"] },
  { request: "Make a 4-week lesson plan for an 'AI agents for freelancers' module with a quiz for each week.", expect: ["course"] },
  { request: "Three students missed the last two classes. Draft a gentle reminder and tell me what the recording policy is.", expect: ["student"] },
  { request: "Weekly report: revenue was PKR 320,000 from 40 enrolments, 180 leads. What is our conversion rate and what stands out?", expect: ["analytics"] },
  { request: "Is Claude's MCP support useful for Pakistani small businesses? Give me a short explainer I can teach tomorrow.", expect: ["research", "course"] },
  { request: "Remember that I prefer Roman Urdu for all WhatsApp replies.", expect: [], direct: true },
  { request: "Research the best free AI video tools right now, then write a YouTube script comparing them in Urdu.", expect: ["research", "content"] },
  { request: "What time zone does the command center use for reports?", expect: [], direct: true },
];

const env = loadEnv();
if (!env.ANTHROPIC_API_KEY) {
  console.error("✖ ANTHROPIC_API_KEY is not set. This eval needs the real model.");
  process.exit(1);
}
const provider = new AnthropicProvider(env.ANTHROPIC_API_KEY);
const ids = Object.keys(SPECIALISTS) as [AgentId, ...AgentId[]];
const schema = planSchema(ids);
const spec = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
delete spec.$schema;
const log = pino({ level: "info" });

let pass = 0;
for (const c of CASES) {
  const res = await provider.generate({
    model: orchestrator.model?.model ?? env.DEFAULT_MODEL,
    system: orchestrator.systemPrompt,
    effort: orchestrator.effort,
    tools: [{ name: "finish", description: "Submit your plan.", inputSchema: spec }],
    messages: [{ role: "user", content: `Specialist catalogue:\n${agentCatalogue()}\n\nRequest from Aamir:\n${c.request}\n\n(Evaluation run: submit the plan with finish right away; do not call other tools.)` }],
  });
  const call = res.toolCalls.find((t) => t.name === "finish");
  const parsed = call ? schema.safeParse(call.input) : undefined;
  const plan = parsed?.success ? (parsed.data as Plan) : undefined;
  const agents = new Set(plan?.steps.map((s) => s.agent) ?? []);
  const ok =
    !!plan &&
    c.expect.every((a) => agents.has(a)) &&
    !(c.forbid ?? []).some((a) => agents.has(a)) &&
    (c.direct ? plan.steps.length === 0 || c.expect.length === 0 : plan.steps.length > 0);
  if (ok) pass++;
  log.info({ ok, request: c.request.slice(0, 70), got: [...agents], expected: c.expect, direct: plan?.steps.length === 0, tokens: res.usage }, ok ? "PASS" : "FAIL");
}
console.log(`\nRouting: ${pass}/${CASES.length} passed`);
process.exit(pass === CASES.length ? 0 : 1);
