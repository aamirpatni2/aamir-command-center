import type { Env } from "@acc/config";
import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { ModelNotConfiguredError, type ModelProvider } from "./types.js";

export interface ResolvedModel {
  provider: ModelProvider;
  model: string;
}

/**
 * Picks the provider for a run. Real providers need their key; the mock is used only when
 * explicitly enabled (dev/test) AND the real key is missing.
 */
export function resolveModel(
  env: Pick<Env, "ANTHROPIC_API_KEY" | "DEFAULT_MODEL_PROVIDER" | "DEFAULT_MODEL" | "ACC_ENABLE_MOCKS" | "NODE_ENV">,
  selector?: { provider?: string; model?: string },
): ResolvedModel {
  const providerId = selector?.provider ?? env.DEFAULT_MODEL_PROVIDER;
  const model = selector?.model ?? env.DEFAULT_MODEL;
  if (providerId === "anthropic") {
    if (env.ANTHROPIC_API_KEY) return { provider: new AnthropicProvider(env.ANTHROPIC_API_KEY), model };
    if (env.ACC_ENABLE_MOCKS && env.NODE_ENV !== "production") return { provider: new MockProvider(), model: "mock" };
    throw new ModelNotConfiguredError("anthropic", "ANTHROPIC_API_KEY");
  }
  // OpenAI / Google adapters implement the same interface in a later milestone.
  throw new ModelNotConfiguredError(providerId, providerId === "openai" ? "OPENAI_API_KEY (adapter not built yet)" : "GOOGLE_AI_API_KEY (adapter not built yet)");
}

/** True when a task could run right now (real key, or mocks allowed in dev). */
export function modelAvailability(env: Parameters<typeof resolveModel>[0]): { available: boolean; mock: boolean; reason?: string } {
  try {
    const r = resolveModel(env);
    return { available: true, mock: r.provider.isMock };
  } catch (e) {
    return { available: false, mock: false, reason: (e as Error).message };
  }
}
