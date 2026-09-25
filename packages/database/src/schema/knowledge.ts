import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common.js";
import { contentLanguage, knowledgeCategory, knowledgeStatus } from "./enums.js";
import { users } from "./identity.js";

export const EMBEDDING_DIMENSIONS = 1536;

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
  (t) => [uniqueIndex("knowledge_chunks_doc_index_unique").on(t.documentId, t.chunkIndex)],
);
