/**
 * Voyage AI embeddings (Anthropic's recommended embedding provider).
 * POST https://api.voyageai.com/v1/embeddings  { input, model, input_type, output_dimension }
 */
import type { Embedder } from "@acc/database";

export class VoyageEmbedder implements Embedder {
  readonly provider = "voyage";
  constructor(
    private readonly apiKey: string,
    readonly model = "voyage-3.5",
    readonly dimensions = 1024,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
    const out: number[][] = [];
    // Keep batches small enough for the API's per-request limits.
    for (let i = 0; i < texts.length; i += 64) {
      const res = await this.fetchImpl("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ input: texts.slice(i, i + 64), model: this.model, input_type: kind, output_dimension: this.dimensions }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Voyage embeddings failed (HTTP ${res.status})`);
      const data = (await res.json()) as { data: { embedding: number[]; index: number }[] };
      out.push(...data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  }
}

export function embedderFromEnv(env: { VOYAGE_API_KEY?: string; EMBEDDING_MODEL?: string }, fetchImpl?: typeof fetch) {
  return env.VOYAGE_API_KEY ? new VoyageEmbedder(env.VOYAGE_API_KEY, env.EMBEDDING_MODEL ?? "voyage-3.5", 1024, fetchImpl) : null;
}
