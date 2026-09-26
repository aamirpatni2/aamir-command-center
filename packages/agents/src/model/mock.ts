/**
 * MOCK model provider — development and tests only.
 * Never used in production (config refuses ACC_ENABLE_MOCKS there). Every response is
 * labelled "[MOCK]" and every run it serves is stored with model_provider = "mock".
 */
import type { ModelProvider, ModelRequest, ModelResponse, ToolCall } from "./types.js";

export type MockStep =
  | { text?: string; toolCalls?: Omit<ToolCall, "id">[] }
  | { refusal: true }
  | ((req: ModelRequest) => { text?: string; toolCalls?: Omit<ToolCall, "id">[] });

let callCounter = 0;

export class MockProvider implements ModelProvider {
  readonly id = "mock" as const;
  readonly isMock = true;
  readonly calls: ModelRequest[] = [];

  /** With no script, uses a generic demo behaviour: search the KB once, then answer. */
  constructor(private readonly script?: MockStep[]) {}

  async generate(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(structuredClone(req));
    const turn = this.calls.length - 1;
    const step = this.script ? this.script[turn] : this.demoStep(req);
    if (!step) return this.respond({ text: "[MOCK] Script exhausted." });
    if (typeof step === "object" && "refusal" in step) {
      return { ...this.respond({ text: "" }), stopReason: "refusal", refusal: { category: "mock", explanation: "Scripted refusal" } };
    }
    return this.respond(typeof step === "function" ? step(req) : step);
  }

  /**
   * Demo behaviour when no script is given. Recognises the orchestration phases by the `finish`
   * tool's schema. Routing here is a crude keyword rule, NOT model intelligence — it only exists
   * so the pipeline can be exercised without an API key.
   */
  private demoStep(req: ModelRequest) {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const full = lastUser && lastUser.role === "user" ? lastUser.content : "";
    // Planner inputs say "Request from Aamir:", specialist inputs "Original request from Aamir (context only):".
    const request = (full.split(/request from Aamir[^:\n]*:\s*/i).at(-1) ?? full).split("Specialist catalogue:")[0]!.trim();
    const hasToolResults = req.messages.some((m) => m.role === "tool_results");
    const finish = req.tools.find((t) => t.name === "finish");
    const props = Object.keys((finish?.inputSchema.properties as Record<string, unknown>) ?? {});

    // Research demo: try the web (honestly reports not_configured without a key), then save an all-unverified report.
    if (req.tools.some((t) => t.name === "research.save") && props.includes("output")) {
      const results = req.messages.filter((m) => m.role === "tool_results");
      if (results.length === 0) return { text: "[MOCK] Searching the web.", toolCalls: [{ name: "web.search", input: { query: request.slice(0, 120), freshness: "week" } }] };
      if (results.length === 1) {
        return {
          toolCalls: [{
            name: "research.save",
            input: {
              title: `[MOCK] ${request.slice(0, 90)}`,
              summary: "[MOCK] Simulated research report. With a web search key and ANTHROPIC_API_KEY, real sources are searched, opened and verified.",
              claims: [
                { claim: "[MOCK] Example claim that would need a source", status: "verified", sources: [{ url: "https://example.com/not-actually-opened" }] },
                { claim: "[MOCK] Example time-sensitive claim", status: "unverified", sources: [] },
              ],
              teachingNotes: "[MOCK] Teaching notes appear here.",
            },
          }],
        };
      }
    }
    // Content demo: save one clearly-labelled mock Reel draft, then finish.
    if (req.tools.some((t) => t.name === "content.save") && props.includes("output")) {
      const saved = req.messages.some((m) => m.role === "tool_results" && m.results.some((r) => r.content.includes('"status":"draft"')));
      if (!saved) {
        return {
          text: "[MOCK] Saving a sample Reel draft.",
          toolCalls: [{
            name: "content.save",
            input: {
              type: "reel", language: "ur-roman", platform: "facebook",
              data: {
                title: `[MOCK] ${request.slice(0, 80)}`,
                durationSec: 45,
                hook: "[MOCK] Yeh ek simulated hook hai.",
                beats: [{ start: 3, end: 30, voiceover: "[MOCK] Asli script API key lagane ke baad Claude likhega.", onScreenText: "MOCK" }],
                cta: "Follow karo",
                caption: "[MOCK] Sample caption",
                hashtags: ["AIinUrdu"],
              },
            },
          }],
        };
      }
    }
    // WhatsApp triage demo: read → submit reply for approval + update lead → finish.
    if (req.tools.some((t) => t.name === "conversation.read")) {
      const conversationId = /conversation ([0-9a-f-]{36})/.exec(full)?.[1];
      const results = req.messages.filter((m) => m.role === "tool_results");
      if (conversationId && results.length === 0) {
        return { text: "[MOCK] Reading the conversation.", toolCalls: [{ name: "conversation.read", input: { conversationId } }] };
      }
      if (conversationId && results.length === 1) {
        const read = results[0]!.role === "tool_results" ? results[0]!.results[0]?.content ?? "" : "";
        const leadId = /"lead":\{"id":"([0-9a-f-]{36})"/.exec(read)?.[1];
        return {
          text: "[MOCK] Drafting a reply for approval and updating the lead.",
          toolCalls: [
            { name: "whatsapp.send", input: { conversationId, text: "[MOCK] Walaikum salam! Shukriya message karne ka. Details confirm karke jaldi batate hain." } },
            ...(leadId ? [{ name: "crm.lead.update", input: { leadId, status: "contacted", appendNote: "[MOCK] Triaged by the mock model." } }] : []),
          ],
        };
      }
    }
    if (!hasToolResults && req.tools.some((t) => t.name === "kb.search") && !props.includes("answer")) {
      return { text: "[MOCK] Checking approved knowledge first.", toolCalls: [{ name: "kb.search", input: { query: request.slice(0, 200) } }] };
    }
    if (props.includes("steps")) return { toolCalls: [{ name: "finish", input: mockPlan(request) }] };
    if (props.includes("answer")) {
      const steps = [...full.matchAll(/<step number="(\d+)" agent="(\w+)" status="(\w+)">/g)].map((m) => `${m[1]}. ${m[2]} — ${m[3]}`);
      return {
        toolCalls: [{
          name: "finish",
          input: {
            answer: `[MOCK] Review of ${steps.length} step(s):\n${steps.join("\n")}\n\nThis summary is simulated. With ANTHROPIC_API_KEY set, the Orchestrator verifies each result and writes the real deliverable here.`,
            issues: ["[MOCK] All outputs are simulated by the mock model."],
            nextSteps: ["Add ANTHROPIC_API_KEY to the server environment to get real results."],
          },
        }],
      };
    }
    if (props.includes("output")) {
      const instruction = /Instruction: (.*)/.exec(full)?.[1] ?? "the step";
      return {
        toolCalls: [{
          name: "finish",
          input: {
            summary: `[MOCK] Simulated result for: ${instruction.slice(0, 160)}`,
            output: `[MOCK] A real specialist would deliver this step here:\n\n> ${instruction}`,
            sources: [],
            unverifiedClaims: ["[MOCK] Output is simulated."],
            blockers: [],
          },
        }],
      };
    }
    return {
      text:
        `[MOCK] This is a simulated answer from the mock model (no ANTHROPIC_API_KEY configured). ` +
        `Request received: "${request.slice(0, 160)}". Add the API key to get real Claude output.`,
    };
  }

  private respond(r: { text?: string; toolCalls?: Omit<ToolCall, "id">[] }): ModelResponse {
    const toolCalls = (r.toolCalls ?? []).map((c) => ({ ...c, id: `mock_call_${++callCounter}` }));
    const text = r.text ?? "";
    const content = [
      ...(text ? [{ type: "text", text }] : []),
      ...toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
    ];
    return {
      text,
      toolCalls,
      stopReason: toolCalls.length ? "tool_use" : "end_turn",
      servedModel: "mock",
      usage: { inputTokens: 0, outputTokens: 0 },
      raw: { provider: "mock", content },
    };
  }
}

const ROUTES: [RegExp, string, string][] = [
  [/research|news|development|latest|trend|khabar/i, "research", "Research the topic and list the key developments with sources."],
  [/reel|post|caption|hook|script|content|video|image|thumbnail/i, "content", "Create the requested content in Aamir's voice."],
  [/lead|sale|follow.?up|convert|qualif/i, "sales", "Analyse the leads and recommend follow-ups."],
  [/whats ?app|reply|message/i, "whatsapp", "Draft the WhatsApp reply."],
  [/student|attendance|certificate|assignment|recording/i, "student", "Handle the student request."],
  [/\bads?\b|campaign|marketing|audience/i, "marketing", "Prepare the marketing deliverable."],
  [/revenue|report|analytics|conversion rate|kpi/i, "analytics", "Analyse the numbers provided."],
  [/lesson|curriculum|quiz|outline|module/i, "course", "Prepare the course material."],
];

function mockPlan(request: string) {
  const picked = ROUTES.filter(([re]) => re.test(request)).slice(0, 3);
  if (picked.length === 0) {
    return { intent: `[MOCK] ${request.slice(0, 120)}`, language: "en", directAnswer: `[MOCK] Simulated direct answer to: "${request.slice(0, 160)}". Add ANTHROPIC_API_KEY for a real answer.`, steps: [] };
  }
  return {
    intent: `[MOCK] ${request.slice(0, 120)}`,
    language: /[\u0600-\u06FF]/.test(request) ? "ur" : "ur-roman",
    steps: picked.map(([, agent, instruction], i) => ({
      agent,
      instruction: `${instruction} (Request: ${request.slice(0, 200)})`,
      acceptance: "Covers the request completely and marks anything unverified.",
      dependsOn: i > 0 ? [i] : [],
    })),
  };
}
