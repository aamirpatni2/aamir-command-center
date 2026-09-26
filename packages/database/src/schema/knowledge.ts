import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common.js";
import { contentLanguage, knowledgeCategory, knowledgeStatus } from "./enums.js";
import { users } from "./identity.js";

/** Voyage AI embeddings (voyage-3.5) at 1024 dimensions. */
export const EMBEDDING_DIMENSIONS = 1024;

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: id(),
    title: text("title").notNull(),
    category: knowledgeCategory("category").notNull(),
    language: contentLanguage("language").notNull().default("en"),
    body: text("body").notNull(),
    /** Only `approved` documents are used for customer-facing answers. */
    status: knowledgeStatus("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("knowledge_documents_category_status_idx").on(t.category, t.status)],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: id(),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    tokenCount: integer("token_count"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("knowledge_chunks_doc_index_unique").on(t.documentId, t.chunkIndex),
    index("knowledge_chunks_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/** Research output: each claim with its verification status and the sources actually consulted. */
export const researchReports = pgTable(
  "research_reports",
  {
    id: id(),
    taskId: uuid("task_id"),
    runId: uuid("run_id"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    claims: jsonb("claims")
      .$type<{ claim: string; status: "verified" | "unverified" | "contradicted"; sources: { url: string; title?: string }[]; note?: string }[]>()
      .notNull()
      .default([]),
    teachingNotes: text("teaching_notes"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("research_reports_created_idx").on(t.createdAt)],
);
