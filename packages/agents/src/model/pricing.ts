/** USD per million tokens (input, output). Used only for cost estimates on agent runs. */
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-fable-5-1": { in: 10, out: 50 },
};

/** Estimated cost in micro-USD, or null when the model's price is unknown (never guessed). */
export function estimateCostMicroUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return Math.round(inputTokens * p.in + outputTokens * p.out);
}
