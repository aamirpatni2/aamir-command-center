import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "./anthropic.js";

/** Contract test: checks the exact HTTP request we send and how we read the response, without calling the real API. */
function fakeFetch(response: object, status = 200) {
  const requests: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    requests.push({ url: String(url), headers, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, requests };
}

const message = (content: object[], stop_reason = "end_turn", extra: object = {}) => ({
  id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", content, stop_reason,
  usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...extra,
});

describe("AnthropicProvider (contract)", () => {
  it("sends fallbacks, effort, encoded tool names; decodes tool calls", async () => {
    const f = fakeFetch(message([
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "Checking." },
      { type: "tool_use", id: "tu_1", name: "kb__search", input: { query: "fee" } },
    ], "tool_use"));
    const p = new AnthropicProvider("sk-ant-test", f.fn);
    const res = await p.generate({
      model: "claude-opus-5", system: "sys", effort: "high",
      messages: [{ role: "user", content: "fee?" }],
      tools: [{ name: "kb.search", description: "d", inputSchema: { type: "object", properties: {} } }],
    });

    const req = f.requests[0]!;
    expect(req.url).toContain("/v1/messages");
    expect(req.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(req.headers["x-api-key"]).toBe("sk-ant-test");
    expect(req.body).toMatchObject({ model: "claude-opus-5", fallbacks: "default", output_config: { effort: "high" }, system: "sys" });
    expect(req.body.tools[0].name).toBe("kb__search");
    expect(req.body.betas).toBeUndefined(); // sent as a header, not in the body

    expect(res.stopReason).toBe("tool_use");
    expect(res.toolCalls).toEqual([{ id: "tu_1", name: "kb.search", input: { query: "fee" } }]);
    expect(res.usage).toMatchObject({ inputTokens: 120, outputTokens: 40 });

    // Replays raw content (incl. thinking) unchanged on the next turn.
    const f2 = fakeFetch(message([{ type: "text", text: "PKR 8,000" }]));
    const p2 = new AnthropicProvider("sk-ant-test", f2.fn);
    await p2.generate({
      model: "claude-opus-5", system: "sys", tools: [],
      messages: [
        { role: "user", content: "fee?" },
        { role: "assistant", text: res.text, toolCalls: res.toolCalls, raw: res.raw },
        { role: "tool_results", results: [{ toolCallId: "tu_1", content: "{}", isError: false }] },
      ],
    });
    const sent = f2.requests[0]!.body.messages;
    expect(sent[1].content[0]).toMatchObject({ type: "thinking", signature: "sig" });
    expect(sent[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1", is_error: false });
  });

  it("surfaces refusals with their category", async () => {
    const f = fakeFetch(message([], "refusal", { stop_details: { type: "refusal", category: "cyber", explanation: "x" } }));
    const res = await new AnthropicProvider("k", f.fn).generate({ model: "claude-opus-5", system: "s", tools: [], messages: [{ role: "user", content: "x" }] });
    expect(res.stopReason).toBe("refusal");
    expect(res.refusal).toEqual({ category: "cyber", explanation: "x" });
  });

  it("raises typed errors on auth failure", async () => {
    const f = fakeFetch({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401);
    await expect(new AnthropicProvider("bad", f.fn).generate({ model: "claude-opus-5", system: "s", tools: [], messages: [{ role: "user", content: "x" }] }))
      .rejects.toMatchObject({ status: 401 });
  });
});
