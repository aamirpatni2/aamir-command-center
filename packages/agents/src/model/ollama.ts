/**
 * Ollama adapter: free, local models (Qwen, Llama, Gemma…) served by Ollama on the user's own
 * computer. Uses Ollama's native /api/chat endpoint with tool calling. No API key, no cost.
 * Small local models follow instructions less reliably than Claude; the runner's guards
 * (finish nudge, step cap, approvals) still apply unchanged.
 */
import type { ChatMessage, ModelProvider, ModelRequest, ModelResponse, StopReason, ToolCall } from "./types.js";

/** Function names in most chat templates allow [a-zA-Z0-9_-]; our capability names use dots. */
const encodeName = (n: string) => n.replace(/\./g, "__");
const decodeName = (n: string) => n.replace(/__/g, ".");

/** Some models put their reasoning inline; it is not part of the answer. */
const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

interface OllamaToolCall {
  id?: string;
  function: { name: string; arguments: unknown };
}
interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}
interface OllamaChatResponse {
  model: string;
  message?: { role: string; content?: string; tool_calls?: OllamaToolCall[] };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OllamaOptions {
  baseUrl: string;
  /** Context window in tokens. Ollama's own default is too small for agent prompts plus tools. */
  numCtx?: number;
  /** Local models can be slow; one call may take minutes on a laptop CPU. */
  timeoutMs?: number;
  /**
   * Let "thinking" models (Qwen3, DeepSeek-R1…) reason before answering. Off by default: on a
   * laptop it multiplies response time, and small models often spend the whole reply thinking.
   */
  think?: boolean;
  /** Only for contract tests. */
  fetchImpl?: typeof fetch;
}

let idCounter = 0;

export class OllamaProvider implements ModelProvider {
  readonly id = "ollama" as const;
  readonly isMock = false;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OllamaOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private toMessages(system: string, messages: ChatMessage[]): OllamaMessage[] {
    const out: OllamaMessage[] = [{ role: "system", content: system }];
    const names = new Map<string, string>(); // tool call id → tool name, for tool results
    for (const m of messages) {
      if (m.role === "user") out.push({ role: "user", content: m.content });
      else if (m.role === "assistant") {
        for (const c of m.toolCalls) names.set(c.id, encodeName(c.name));
        out.push({
          role: "assistant",
          content: m.text,
          ...(m.toolCalls.length
            ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: encodeName(c.name), arguments: c.input ?? {} } })) }
            : {}),
        });
      } else {
        for (const r of m.results) {
          const name = names.get(r.toolCallId);
          out.push({ role: "tool", content: r.isError ? `ERROR: ${r.content}` : r.content, ...(name ? { tool_name: name } : {}) });
        }
      }
    }
    return out;
  }

  async generate(req: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    const body = {
      model: req.model,
      stream: false,
      think: this.opts.think ?? false,
      messages: this.toMessages(req.system, req.messages),
      tools: req.tools.map((t) => ({
        type: "function",
        function: { name: encodeName(t.name), description: t.description, parameters: t.inputSchema },
      })),
      options: { num_ctx: this.opts.numCtx ?? 16_384, ...(req.maxTokens ? { num_predict: req.maxTokens } : {}) },
    };
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 600_000);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (timeout.aborted) throw new Error(`Ollama did not answer within ${Math.round((this.opts.timeoutMs ?? 600_000) / 1000)} s. Try a smaller model.`);
      throw new Error(`Could not reach Ollama at ${this.baseUrl}. Is the Ollama app running? (${(e as Error).message})`);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status === 404 && /not found/i.test(detail)) {
        throw new Error(`Ollama model "${req.model}" is not downloaded. On the computer running Ollama run: ollama pull ${req.model}`);
      }
      throw new Error(`Ollama returned HTTP ${res.status}: ${detail}`);
    }
    const data = (await res.json()) as OllamaChatResponse;

    const toolCalls: ToolCall[] = (data.message?.tool_calls ?? []).map((c) => ({
      id: c.id ?? newId(),
      name: decodeName(c.function.name),
      input: parseArguments(c.function.arguments),
    }));
    let text = stripThinking(data.message?.content ?? "");
    if (toolCalls.length === 0) {
      const recovered = toolCallFromText(text, req.tools.map((t) => t.name));
      if (recovered) {
        toolCalls.push(recovered);
        text = "";
      }
    }
    const stopReason: StopReason = toolCalls.length ? "tool_use" : data.done_reason === "length" ? "max_tokens" : "end_turn";

    return {
      text,
      toolCalls,
      stopReason,
      servedModel: data.model || req.model,
      usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
      raw: { provider: this.id, content: data.message ?? null },
    };
  }
}

const newId = () => `ollama_${Date.now().toString(36)}_${++idCounter}`;

/**
 * Small local models often write a tool call as plain JSON text instead of using the tool-call
 * format. When the whole reply is one JSON object, treat it as the call it describes:
 * `{"name": "<tool>", "arguments": {...}}`, or else the final result for the `finish` tool.
 * The runner still validates the input against the tool's schema.
 */
function toolCallFromText(text: string, toolNames: string[]): ToolCall | null {
  const body = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!body.startsWith("{") || !body.endsWith("}")) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(body);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const named = typeof o.name === "string" ? decodeName(o.name) : null;
  const args = o.arguments ?? o.parameters;
  if (named && toolNames.includes(named) && args !== undefined) {
    return { id: newId(), name: named, input: parseArguments(args) };
  }
  if (toolNames.includes("finish")) return { id: newId(), name: "finish", input: o };
  return null;
}

/** Ollama returns arguments as an object; a few models send a JSON string instead. */
function parseArguments(args: unknown): unknown {
  if (typeof args !== "string") return args ?? {};
  try {
    return JSON.parse(args);
  } catch {
    return { _raw: args };
  }
}
