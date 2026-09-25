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
    const request = (full.split("Request from Aamir:").at(-1) ?? full).split("Specialist catalogue:")[0]!.trim();
    const hasToolResults = req.messages.some((m) => m.role === "tool_results");
    const finish = req.tools.find((t) => t.name === "finish");
    const props = Object.keys((finish?.inputSchema.properties as Record<string, unknown>) ?? {});

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
