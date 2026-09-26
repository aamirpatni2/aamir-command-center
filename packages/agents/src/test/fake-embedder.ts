import type { Embedder } from "@acc/database";

/** Deterministic bag-of-words embedder for tests: similar words → similar vectors. Not a real model. */
export class FakeEmbedder implements Embedder {
  readonly provider = "fake";
  readonly model = "bag-of-words";
  readonly dimensions = 1024;
  async embed(texts: string[]) {
    return texts.map((t) => {
      const v = new Array(this.dimensions).fill(0);
      for (const w of t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 2)) {
        let h = 0;
        for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        v[h % this.dimensions] += 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}
