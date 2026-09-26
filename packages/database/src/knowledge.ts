/**
 * Knowledge base: only APPROVED documents are chunked and searchable by agents.
 * Search is hybrid: Postgres full-text search always; vector similarity when an embedder is configured;
 * results merged with reciprocal rank fusion.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import type { DbOrTx } from "./crm.js";
import { knowledgeChunks, knowledgeDocuments } from "./schema/index.js";

export interface Embedder {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}

/** Splits text into ~target-sized chunks on paragraph/sentence boundaries, with a small overlap. */
export function chunkText(text: string, target = 900, overlap = 120): string[] {
  const paras = text.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paras) {
    if (p.length <= target) pieces.push(p);
    else pieces.push(...(p.match(new RegExp(`[\\s\\S]{1,${target}}(?:[.!?۔؟]\\s|\\n|$)|[\\s\\S]{1,${target}}`, "g")) ?? [p]).map((x) => x.trim()));
  }
  const chunks: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (cur && cur.length + piece.length + 2 > target) {
      chunks.push(cur);
      cur = cur.slice(-overlap) + "\n\n" + piece;
    } else {
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Rebuilds chunks (and embeddings, if available) for a document. */
export async function indexDocument(db: DbOrTx, documentId: string, embedder?: Embedder | null) {
  const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId));
  if (!doc) return 0;
  await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, documentId));
  const texts = chunkText(doc.body).map((c) => `${doc.title}\n\n${c}`);
  const vectors = embedder ? await embedder.embed(texts, "document") : null;
  if (texts.length) {
    await db.insert(knowledgeChunks).values(
      texts.map((content, i) => ({
        documentId,
        chunkIndex: i,
        content,
        embedding: vectors?.[i] ?? null,
        tokenCount: Math.ceil(content.length / 4),
        metadata: vectors ? { embeddedWith: `${embedder!.provider}/${embedder!.model}` } : {},
      })),
    );
  }
  return texts.length;
}

export async function approveDocument(db: Database, documentId: string, userId: string, embedder?: Embedder | null) {
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .update(knowledgeDocuments)
      .set({ status: "approved", approvedBy: userId, approvedAt: new Date() })
      .where(and(eq(knowledgeDocuments.id, documentId), isNull(knowledgeDocuments.deletedAt)))
      .returning();
    if (!doc) return null;
    const chunks = await indexDocument(tx, documentId, embedder);
    return { doc, chunks };
  });
}

/** Removes a document from agent search (archive or edit-back-to-draft). */
export async function unindexDocument(db: DbOrTx, documentId: string) {
  await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, documentId));
}

export interface KnowledgeHit {
  documentId: string;
  title: string;
  category: string;
  content: string;
  approvedAt: Date | null;
  match: ("text" | "semantic" | "keyword")[];
  score: number;
}

export async function searchKnowledge(
  db: DbOrTx,
  query: string,
  opts: { category?: string; limit?: number; embedder?: Embedder | null } = {},
): Promise<KnowledgeHit[]> {
  const limit = opts.limit ?? 5;
  const approved = and(eq(knowledgeDocuments.status, "approved"), isNull(knowledgeDocuments.deletedAt), opts.category ? sql`${knowledgeDocuments.category} = ${opts.category}` : undefined);
  const cols = {
    documentId: knowledgeDocuments.id, title: knowledgeDocuments.title, category: knowledgeDocuments.category,
    content: knowledgeChunks.content, approvedAt: knowledgeDocuments.approvedAt, chunkId: knowledgeChunks.id,
  };
  const pool = limit * 3;

  // Full-text (OR of words so partial matches still rank).
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1).slice(0, 12);
  const tsq = words.length ? sql`to_tsquery('simple', ${words.map((w) => `${w.replace(/'/g, "")}:*`).join(" | ")})` : null;
  const textRows = tsq
    ? await db
        .select({ ...cols, rank: sql<number>`ts_rank(tsv, ${tsq})` })
        .from(knowledgeChunks)
        .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeChunks.documentId))
        .where(and(approved, sql`tsv @@ ${tsq}`))
        .orderBy(sql`ts_rank(tsv, ${tsq}) desc`)
        .limit(pool)
    : [];

  let vectorRows: typeof textRows = [];
  if (opts.embedder) {
    const [qv] = await opts.embedder.embed([query], "query");
    const lit = `[${qv!.join(",")}]`;
    vectorRows = await db
      .select({ ...cols, rank: sql<number>`1 - (${knowledgeChunks.embedding} <=> ${lit}::vector)` })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeChunks.documentId))
      .where(and(approved, sql`${knowledgeChunks.embedding} is not null`))
      .orderBy(sql`${knowledgeChunks.embedding} <=> ${lit}::vector`)
      .limit(pool);
  }

  // Reciprocal rank fusion.
  const merged = new Map<string, KnowledgeHit>();
  const add = (rows: typeof textRows, kind: "text" | "semantic") =>
    rows.forEach((r, i) => {
      const hit = merged.get(r.chunkId) ?? { documentId: r.documentId, title: r.title, category: r.category, content: r.content, approvedAt: r.approvedAt, match: [], score: 0 };
      hit.score += 1 / (60 + i);
      hit.match.push(kind);
      merged.set(r.chunkId, hit);
    });
  add(textRows, "text");
  add(vectorRows, "semantic");
  let hits = [...merged.values()].sort((a, b) => b.score - a.score);

  // Approved documents that were never indexed (e.g. created directly in the DB): keyword fallback.
  if (hits.length < limit && words.length) {
    const unindexed = await db
      .select({ documentId: knowledgeDocuments.id, title: knowledgeDocuments.title, category: knowledgeDocuments.category, content: sql<string>`left(${knowledgeDocuments.body}, 1500)`, approvedAt: knowledgeDocuments.approvedAt })
      .from(knowledgeDocuments)
      .where(
        and(
          approved,
          sql`not exists (select 1 from knowledge_chunks c where c.document_id = "knowledge_documents"."id")`,
          sql`(${sql.join(words.map((w) => sql`(${knowledgeDocuments.title} ilike ${`%${w}%`} or ${knowledgeDocuments.body} ilike ${`%${w}%`})`), sql` or `)})`,
        ),
      )
      .limit(limit);
    hits = hits.concat(unindexed.map((d) => ({ ...d, match: ["keyword" as const], score: 0 })));
  }

  // One best chunk per document keeps results diverse.
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.documentId) ? false : (seen.add(h.documentId), true))).slice(0, limit);
}
