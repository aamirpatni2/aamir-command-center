import { describe, expect, it } from "vitest";
import { OllamaProvider } from "./ollama.js";
import { modelAvailability, resolveModel } from "./registry.js";

/** Contract test: checks the exact request we send to Ollama and how we read its reply, without a running Ollama. */
function fakeFetch(response: object | string, status = 200) {
  const requests: { url: string; body: any }[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const text = typeof response === "string" ? response : JSON.stringify(response);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, requests };
}

const tools = [{ name: "kb.search", description: "Search", inputSchema: { type: "object", properties: { query: { type: "string" } } } }];

describe("OllamaProvider (contract)", () => {
  it("sends system, tools and options to /api/chat and decodes tool calls", async () => {
    const f = fakeFetch({
      model: "qwen3:8b",
      message: { role: "assistant", content: "<think>let me look</think>Checking.", tool_calls: [{ function: { name: "kb__search", arguments: { query: "fee" } } }] },
      done_reason: "stop", prompt_eval_count: 300, eval_count: 20,
    });
    const p = new OllamaProvider({ baseUrl: "http://host.docker.internal:11434/", numCtx: 8192, fetchImpl: f.fn });
    const res = await p.generate({ model: "qwen3:8b", system: "sys", maxTokens: 2000, messages: [{ role: "user", content: "fee?" }], tools });

    const req = f.requests[0]!;
    expect(req.url).toBe("http://host.docker.internal:11434/api/chat");
    expect(req.body).toMatchObject({ model: "qwen3:8b", stream: false, think: false, options: { num_ctx: 8192, num_predict: 2000 } });
    expect(req.body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(req.body.tools[0]).toMatchObject({ type: "function", function: { name: "kb__search", description: "Search" } });

    expect(res.stopReason).toBe("tool_use");
    expect(res.text).toBe("Checking.");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toMatchObject({ name: "kb.search", input: { query: "fee" } });
    expect(res.toolCalls[0]!.id).toBeTruthy();
    expect(res.usage).toEqual({ inputTokens: 300, outputTokens: 20 });
    expect(res.servedModel).toBe("qwen3:8b");
  });

  it("replays tool calls and results in Ollama's shape", async () => {
    const f = fakeFetch({ model: "qwen3:8b", message: { role: "assistant", content: "Fee is Rs. 5,000." }, done_reason: "stop" });
    const p = new OllamaProvider({ baseUrl: "http://localhost:11434", fetchImpl: f.fn });
    const res = await p.generate({
      model: "qwen3:8b", system: "s", tools,
      messages: [
        { role: "user", content: "fee?" },
        { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "kb.search", input: { query: "fee" } }] },
        { role: "tool_results", results: [{ toolCallId: "c1", content: "{\"hits\":1}", isError: false }, { toolCallId: "c1", content: "boom", isError: true }] },
      ],
    });
    const msgs = f.requests[0]!.body.messages;
    expect(msgs[2]).toEqual({ role: "assistant", content: "", tool_calls: [{ function: { name: "kb__search", arguments: { query: "fee" } } }] });
    expect(msgs[3]).toEqual({ role: "tool", content: "{\"hits\":1}", tool_name: "kb__search" });
    expect(msgs[4]).toMatchObject({ role: "tool", content: "ERROR: boom" });
    expect(res).toMatchObject({ stopReason: "end_turn", text: "Fee is Rs. 5,000.", toolCalls: [] });
  });

  it("parses string arguments and maps a length stop to max_tokens", async () => {
    const f = fakeFetch({ model: "m", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "finish", arguments: "{\"summary\":\"ok\"}" } }] } });
    const p = new OllamaProvider({ baseUrl: "http://x", fetchImpl: f.fn });
    expect((await p.generate({ model: "m", system: "s", tools, messages: [] })).toolCalls[0]!.input).toEqual({ summary: "ok" });

    const g = fakeFetch({ model: "m", message: { role: "assistant", content: "cut off" }, done_reason: "length" });
    const q = new OllamaProvider({ baseUrl: "http://x", fetchImpl: g.fn });
    expect((await q.generate({ model: "m", system: "s", tools, messages: [] })).stopReason).toBe("max_tokens");
  });

  it("recovers tool calls that a small model wrote as JSON text", async () => {
    const withFinish = [...tools, { name: "finish", description: "Submit", inputSchema: { type: "object" } }];
    const ask = async (content: string, t = withFinish) => {
      const f = fakeFetch({ model: "m", message: { role: "assistant", content }, done_reason: "stop" });
      return new OllamaProvider({ baseUrl: "http://x", fetchImpl: f.fn }).generate({ model: "m", system: "s", tools: t, messages: [] });
    };
    const named = await ask('{"name": "kb__search", "arguments": {"query": "fee"}}');
    expect(named).toMatchObject({ stopReason: "tool_use", text: "", toolCalls: [{ name: "kb.search", input: { query: "fee" } }] });
    const result = await ask('```json\n{"intent": "question", "steps": []}\n```');
    expect(result.toolCalls[0]).toMatchObject({ name: "finish", input: { intent: "question", steps: [] } });
    // Ordinary prose, or JSON when there is no finish tool, stays a text answer.
    expect((await ask("The fee is Rs. 5,000.")).toolCalls).toEqual([]);
    expect((await ask('{"a": 1}', tools)).toolCalls).toEqual([]);
  });

  it("explains a missing model and an unreachable Ollama", async () => {
    const missing = new OllamaProvider({ baseUrl: "http://x", fetchImpl: fakeFetch('{"error":"model \\"qwen3:8b\\" not found, try pulling it first"}', 404).fn });
    await expect(missing.generate({ model: "qwen3:8b", system: "s", tools, messages: [] })).rejects.toThrow(/ollama pull qwen3:8b/);

    const down = new OllamaProvider({ baseUrl: "http://x", fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await expect(down.generate({ model: "m", system: "s", tools, messages: [] })).rejects.toThrow(/Is the Ollama app running/);
  });
});

describe("resolveModel with Ollama", () => {
  const base = { DEFAULT_MODEL_PROVIDER: "ollama" as const, DEFAULT_MODEL: "claude-opus-5", NODE_ENV: "production" as const, ACC_ENABLE_MOCKS: false, ANTHROPIC_API_KEY: undefined };

  it("uses the local model for every agent, ignoring Claude model names", () => {
    const r = resolveModel({ ...base, OLLAMA_BASE_URL: "http://host.docker.internal:11434", OLLAMA_MODEL: "llama3.1:8b" }, { model: "claude-sonnet-5" });
    expect(r.provider.id).toBe("ollama");
    expect(r.provider.isMock).toBe(false);
    expect(r.model).toBe("llama3.1:8b");
    expect(modelAvailability({ ...base, OLLAMA_BASE_URL: "http://h:11434", OLLAMA_MODEL: "qwen3:8b" })).toEqual({ available: true, mock: false, provider: "ollama", model: "qwen3:8b" });
  });

  it("says which setting is missing", () => {
    expect(() => resolveModel(base)).toThrow(/OLLAMA_BASE_URL/);
    expect(modelAvailability(base).available).toBe(false);
  });
});
