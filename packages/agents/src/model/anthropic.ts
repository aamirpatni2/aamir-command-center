import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ModelProvider, ModelRequest, ModelResponse, StopReason, ToolCall } from "./types.js";

/** Anthropic tool names allow [a-zA-Z0-9_-]; our capability names use dots. */
const encodeName = (n: string) => n.replace(/\./g, "__");
const decodeName = (n: string) => n.replace(/__/g, ".");

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic" as const;
  readonly isMock = false;
  private readonly client: Anthropic;

  /** `fetchImpl` is only for contract tests; production uses the SDK default. */
  constructor(apiKey: string, fetchImpl?: typeof fetch) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, ...(fetchImpl ? { fetch: fetchImpl, maxRetries: 0 } : {}) });
  }

  private toMessages(messages: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
    return messages.map((m): Anthropic.Beta.BetaMessageParam => {
      if (m.role === "user") return { role: "user", content: m.content };
      if (m.role === "tool_results") {
        return {
          role: "user",
          content: m.results.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.toolCallId,
            content: r.content,
            is_error: r.isError,
          })),
        };
      }
      // Replay provider-native content unchanged (keeps thinking blocks valid inside the loop).
      if (m.raw?.provider === this.id) {
        return { role: "assistant", content: m.raw.content as Anthropic.Beta.BetaContentBlockParam[] };
      }
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const c of m.toolCalls) content.push({ type: "tool_use", id: c.id, name: encodeName(c.name), input: c.input });
      return { role: "assistant", content };
    });
  }

  async generate(req: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    const params = {
      model: req.model,
      max_tokens: req.maxTokens ?? 16_000,
      system: req.system,
      messages: this.toMessages(req.messages),
      tools: req.tools.map((t) => ({
        name: encodeName(t.name),
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      })),
      ...(req.effort ? { output_config: { effort: req.effort } } : {}),
      // Server-side fallback: a safety-declined request is re-run on Anthropic's recommended model.
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    };
    // `fallbacks: "default"` may be newer than the installed SDK's typings.
    const res = (await this.client.beta.messages.create(
      params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming,
      { signal },
    )) as Anthropic.Beta.BetaMessage;

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of res.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: decodeName(block.name), input: block.input });
    }

    const stopMap: Record<string, StopReason> = {
      end_turn: "end_turn",
      tool_use: "tool_use",
      max_tokens: "max_tokens",
      refusal: "refusal",
    };
    const stopReason = stopMap[res.stop_reason ?? ""] ?? "other";
    const details = (res as { stop_details?: { category?: string | null; explanation?: string | null } | null }).stop_details;

    return {
      text,
      toolCalls,
      stopReason,
      servedModel: res.model,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? undefined,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? undefined,
      },
      raw: { provider: this.id, content: res.content },
      ...(stopReason === "refusal"
        ? { refusal: { category: details?.category ?? null, explanation: details?.explanation ?? null } }
        : {}),
    };
  }
}
