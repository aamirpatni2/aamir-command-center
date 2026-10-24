import type { Env } from "@acc/config";
import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { OllamaProvider } from "./ollama.js";
import { ModelNotConfiguredError, type ModelProvider } from "./types.js";

export interface ResolvedModel {
  provider: ModelProvider;
  model: string;
}

type ModelEnv = Pick<Env, "ANTHROPIC_API_KEY" | "DEFAULT_MODEL_PROVIDER" | "DEFAULT_MODEL" | "ACC_ENABLE_MOCKS" | "NODE_ENV"> &
  Partial<Pick<Env, "OLLAMA_BASE_URL" | "OLLAMA_MODEL" | "OLLAMA_NUM_CTX" | "OLLAMA_TIMEOUT_SECONDS" | "OLLAMA_THINK">>;

/**
 * Picks the provider for a run. Real providers need their key (Ollama: its URL); the mock is
 * used only when explicitly enabled (dev/test) AND the real provider is not configured.
 */
export function resolveModel(env: ModelEnv, selector?: { provider?: string; model?: string }): ResolvedModel {
  const providerId = selector?.provider ?? env.DEFAULT_MODEL_PROVIDER;
  const mockAllowed = env.ACC_ENABLE_MOCKS && env.NODE_ENV !== "production";
  if (providerId === "anthropic") {
    const model = selector?.model ?? env.DEFAULT_MODEL;
    if (env.ANTHROPIC_API_KEY) return { provider: new AnthropicProvider(env.ANTHROPIC_API_KEY), model };
    if (mockAllowed) return { provider: new MockProvider(), model: "mock" };
    throw new ModelNotConfiguredError("anthropic", "ANTHROPIC_API_KEY");
  }
  if (providerId === "ollama") {
    // Agent definitions may name Claude models; with Ollama every agent uses the local model.
    const model = selector?.provider === "ollama" && selector.model ? selector.model : (env.OLLAMA_MODEL ?? "qwen3:8b");
    if (env.OLLAMA_BASE_URL) {
      const provider = new OllamaProvider({
        baseUrl: env.OLLAMA_BASE_URL,
        numCtx: env.OLLAMA_NUM_CTX,
        timeoutMs: env.OLLAMA_TIMEOUT_SECONDS ? env.OLLAMA_TIMEOUT_SECONDS * 1000 : undefined,
        think: env.OLLAMA_THINK,
      });
      return { provider, model };
    }
    if (mockAllowed) return { provider: new MockProvider(), model: "mock" };
    throw new ModelNotConfiguredError("ollama", "OLLAMA_BASE_URL");
  }
  // OpenAI / Google adapters implement the same interface in a later milestone.
  throw new ModelNotConfiguredError(providerId, providerId === "openai" ? "OPENAI_API_KEY (adapter not built yet)" : "GOOGLE_AI_API_KEY (adapter not built yet)");
}

/** True when a task could run right now (provider configured, or mocks allowed in dev). */
export function modelAvailability(env: ModelEnv): { available: boolean; mock: boolean; provider?: string; model?: string; reason?: string } {
  try {
    const r = resolveModel(env);
    return { available: true, mock: r.provider.isMock, provider: r.provider.id, model: r.model };
  } catch (e) {
    return { available: false, mock: false, reason: (e as Error).message };
  }
}
