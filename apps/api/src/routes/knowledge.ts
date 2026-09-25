import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { embedderFromEnv } from "@acc/agents";
import type { Env } from "@acc/config";
import { and, approveDocument, desc, eq, indexDocument, isNull, schema, searchKnowledge, sql, unindexDocument, writeAudit, type Database } from "@acc/database";
import { CONTENT_LANGUAGES } from "@acc/shared";
import { conflict, notFound, parse } from "../lib/errors.js";
import { auditMeta } from "../lib/audit.js";
import { requireAuth } from "../plugins/auth.js";

const CATEGORIES = ["course", "pricing", "schedule", "policy", "faq", "teaching", "business", "marketing", "brand"] as const;
const idParam = z.object({ id: z.string().uuid() });
const docBody = z.object({
  title: z.string().trim().min(2).max(200),
  category: z.enum(CATEGORIES),
  language: z.enum(CONTENT_LANGUAGES).default("en"),
  body: z.string().trim().min(10).max(100_000),
});

export async function knowledgeRoutes(app: FastifyInstance, opts: { db: Database; env: Env }) {
  const { db, env } = opts;
  const embedder = embedderFromEnv(env);
  const active = isNull(schema.knowledgeDocuments.deletedAt);

  app.get("/api/knowledge", { preHandler: requireAuth("knowledge:read") }, async (req) => {
    const q = parse(z.object({ status: z.enum(["draft", "approved", "archived"]).optional(), category: z.enum(CATEGORIES).optional(), q: z.string().max(100).optional() }), req.query);
    const docs = await db
      .select({
        id: schema.knowledgeDocuments.id, title: schema.knowledgeDocuments.title, category: schema.knowledgeDocuments.category,
        language: schema.knowledgeDocuments.language, status: schema.knowledgeDocuments.status, version: schema.knowledgeDocuments.version,
        approvedAt: schema.knowledgeDocuments.approvedAt, updatedAt: schema.knowledgeDocuments.updatedAt,
        preview: sql<string>`left(${schema.knowledgeDocuments.body}, 200)`,
        chunks: sql<number>`(select count(*)::int from knowledge_chunks c where c.document_id = "knowledge_documents"."id")`,
        embedded: sql<number>`(select count(*)::int from knowledge_chunks c where c.document_id = "knowledge_documents"."id" and c.embedding is not null)`,
      })
      .from(schema.knowledgeDocuments)
      .where(
        and(
          active,
          q.status ? eq(schema.knowledgeDocuments.status, q.status) : undefined,
          q.category ? eq(schema.knowledgeDocuments.category, q.category) : undefined,
          q.q ? sql`(${schema.knowledgeDocuments.title} ilike ${`%${q.q}%`} or ${schema.knowledgeDocuments.body} ilike ${`%${q.q}%`})` : undefined,
        ),
      )
      .orderBy(desc(schema.knowledgeDocuments.updatedAt));
    return { documents: docs, search: { semantic: !!embedder, model: embedder?.model ?? null } };
  });

  app.get("/api/knowledge/search", { preHandler: requireAuth("knowledge:read") }, async (req) => {
    const q = parse(z.object({ q: z.string().trim().min(1).max(300), category: z.enum(CATEGORIES).optional() }), req.query);
    const hits = await searchKnowledge(db, q.q, { category: q.category, limit: 5, embedder });
    return { results: hits, semantic: !!embedder };
  });

  app.get("/api/knowledge/:id", { preHandler: requireAuth("knowledge:read") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [doc] = await db.select().from(schema.knowledgeDocuments).where(and(eq(schema.knowledgeDocuments.id, id), active));
    if (!doc) throw notFound("Document");
    return { document: doc };
  });

  app.post("/api/knowledge", { preHandler: requireAuth("knowledge:write") }, async (req, reply) => {
    const body = parse(docBody, req.body);
    const [doc] = await db.insert(schema.knowledgeDocuments).values({ ...body, status: "draft" }).returning();
    await writeAudit(db, { ...auditMeta(req), action: "knowledge.create", entityType: "knowledge_document", entityId: doc!.id, metadata: { category: body.category } });
    return reply.code(201).send({ document: doc });
  });

  /** Editing approved knowledge takes it out of agent search until it's approved again. */
  app.patch("/api/knowledge/:id", { preHandler: requireAuth("knowledge:write") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(docBody.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update"), req.body);
    const [before] = await db.select().from(schema.knowledgeDocuments).where(and(eq(schema.knowledgeDocuments.id, id), active));
    if (!before) throw notFound("Document");
    const contentChanged = body.body !== undefined || body.title !== undefined;
    const backToDraft = before.status === "approved" && contentChanged;
    const [doc] = await db
      .update(schema.knowledgeDocuments)
      .set({ ...body, ...(backToDraft ? { status: "draft" as const, version: before.version + 1, approvedAt: null, approvedBy: null } : {}) })
      .where(eq(schema.knowledgeDocuments.id, id))
      .returning();
    if (backToDraft) await unindexDocument(db, id);
    await writeAudit(db, { ...auditMeta(req), action: "knowledge.edit", entityType: "knowledge_document", entityId: id, metadata: { backToDraft } });
    return { document: doc, backToDraft };
  });

  app.post("/api/knowledge/:id/approve", { preHandler: requireAuth("knowledge:approve") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [doc] = await db.select({ status: schema.knowledgeDocuments.status }).from(schema.knowledgeDocuments).where(and(eq(schema.knowledgeDocuments.id, id), active));
    if (!doc) throw notFound("Document");
    if (doc.status === "approved") throw conflict("Already approved");
    let warning: string | undefined;
    let result = await approveDocument(db, id, req.auth!.user.id, embedder).catch((e: Error) => {
      warning = `Semantic indexing failed (${e.message}); approved with full-text search only.`;
      return null;
    });
    if (!result) result = await approveDocument(db, id, req.auth!.user.id, null);
    await writeAudit(db, { ...auditMeta(req), action: "knowledge.approve", entityType: "knowledge_document", entityId: id, metadata: { chunks: result!.chunks, semantic: !!embedder && !warning } });
    return { document: result!.doc, chunks: result!.chunks, warning };
  });

  app.post("/api/knowledge/:id/archive", { preHandler: requireAuth("knowledge:approve") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [doc] = await db.update(schema.knowledgeDocuments).set({ status: "archived" }).where(and(eq(schema.knowledgeDocuments.id, id), active)).returning();
    if (!doc) throw notFound("Document");
    await unindexDocument(db, id);
    await writeAudit(db, { ...auditMeta(req), action: "knowledge.archive", entityType: "knowledge_document", entityId: id });
    return { document: doc };
  });

  /** Re-embeds approved documents (e.g. after adding VOYAGE_API_KEY). */
  app.post("/api/knowledge/reindex", { preHandler: requireAuth("knowledge:approve") }, async (req) => {
    const docs = await db.select({ id: schema.knowledgeDocuments.id }).from(schema.knowledgeDocuments).where(and(active, eq(schema.knowledgeDocuments.status, "approved")));
    let chunks = 0;
    for (const d of docs) chunks += await indexDocument(db, d.id, embedder);
    await writeAudit(db, { ...auditMeta(req), action: "knowledge.reindex", metadata: { documents: docs.length, chunks, semantic: !!embedder } });
    return { documents: docs.length, chunks, semantic: !!embedder };
  });

  // ── Proposed long-term memory (agents propose, humans approve) ─────────
  app.get("/api/memory", { preHandler: requireAuth("knowledge:read") }, async (req) => {
    const q = parse(z.object({ status: z.enum(["proposed", "approved", "rejected"]).default("proposed") }), req.query);
    return { items: await db.select().from(schema.memoryItems).where(eq(schema.memoryItems.status, q.status)).orderBy(desc(schema.memoryItems.createdAt)).limit(100) };
  });

  app.post("/api/memory/:id/decide", { preHandler: requireAuth("knowledge:approve") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { decision } = parse(z.object({ decision: z.enum(["approved", "rejected"]) }), req.body);
    const [item] = await db
      .update(schema.memoryItems)
      .set({ status: decision, approvedBy: decision === "approved" ? req.auth!.user.id : null })
      .where(and(eq(schema.memoryItems.id, id), eq(schema.memoryItems.status, "proposed")))
      .returning();
    if (!item) throw conflict("Not a pending proposal");
    await writeAudit(db, { ...auditMeta(req), action: `memory.${decision}`, entityType: "memory_item", entityId: id });
    return { item };
  });

  // ── Research reports ───────────────────────────────────────────────────
  app.get("/api/research", { preHandler: requireAuth("knowledge:read") }, async () => {
    const rows = await db
      .select({
        id: schema.researchReports.id, title: schema.researchReports.title, summary: schema.researchReports.summary,
        taskId: schema.researchReports.taskId, createdAt: schema.researchReports.createdAt, claims: schema.researchReports.claims,
      })
      .from(schema.researchReports)
      .where(isNull(schema.researchReports.deletedAt))
      .orderBy(desc(schema.researchReports.createdAt))
      .limit(100);
    return {
      reports: rows.map(({ claims, ...r }) => ({
        ...r,
        counts: { verified: claims.filter((c) => c.status === "verified").length, unverified: claims.filter((c) => c.status === "unverified").length, contradicted: claims.filter((c) => c.status === "contradicted").length },
      })),
    };
  });

  app.get("/api/research/:id", { preHandler: requireAuth("knowledge:read") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [report] = await db.select().from(schema.researchReports).where(and(eq(schema.researchReports.id, id), isNull(schema.researchReports.deletedAt)));
    if (!report) throw notFound("Research report");
    return { report };
  });
}
