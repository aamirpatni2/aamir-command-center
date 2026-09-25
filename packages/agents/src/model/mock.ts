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

  private demoStep(req: ModelRequest) {
    const hasSearched = req.messages.some((m) => m.role === "tool_results");
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const full = lastUser && lastUser.role === "user" ? lastUser.content : "";
    const query = (full.split("Request from Aamir:").at(-1) ?? full).trim();
    if (!hasSearched && req.tools.some((t) => t.name === "kb.search")) {
      return { text: "[MOCK] Checking approved knowledge first.", toolCalls: [{ name: "kb.search", input: { query: query.slice(0, 200) } }] };
    }
    return {
      text:
        `[MOCK] This is a simulated answer from the mock model (no ANTHROPIC_API_KEY configured). ` +
        `Request received: "${query.slice(0, 160)}". Add the API key to get real Claude output.`,
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
