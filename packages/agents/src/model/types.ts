/**
 * Provider-neutral model interface. Agents and the runner only ever see these types;
 * each provider adapter converts to/from its own SDK shapes.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input (generated from the tool's Zod schema). */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultMessage {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export type ChatMessage =
  | { role: "user"; content: string }
  /**
   * `raw` is the provider-native assistant content (e.g. Anthropic content blocks incl. thinking).
   * It is replayed unchanged to the same provider, which some models require inside a tool loop.
   */
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; raw?: { provider: string; content: unknown } }
  | { role: "tool_results"; results: ToolResultMessage[] };

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  effort?: Effort;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  /** Model that actually served the request (may differ if a server-side fallback ran). */
  servedModel: string;
  usage: ModelUsage;
  raw: { provider: string; content: unknown };
  refusal?: { category: string | null; explanation: string | null };
}

export interface ModelProvider {
  readonly id: "anthropic" | "openai" | "google" | "mock";
  /** True when results are not from a real model (mocks). Stored on every run. */
  readonly isMock: boolean;
  generate(req: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}

export class ModelNotConfiguredError extends Error {
  readonly code = "MODEL_NOT_CONFIGURED";
  constructor(public readonly provider: string, public readonly envVar: string) {
    super(`Model provider "${provider}" is not configured: set ${envVar} in the server environment.`);
  }
}
