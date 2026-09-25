import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, contentText, desc, eq, isNull, runContentChecks, saveContentDraft, schema, sql, writeAudit, type Database } from "@acc/database";
import { CONTENT_FORMATS, CONTENT_LANGUAGES, CONTENT_PLATFORMS, CONTENT_TYPES, hasPermission, type ContentType } from "@acc/shared";
import { conflict, forbidden, HttpError, notFound, parse } from "../lib/errors.js";
import { auditMeta } from "../lib/audit.js";
import { requireAuth } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });
const STATUSES = ["draft", "in_review", "approved", "scheduled", "published", "rejected"] as const;
type Status = (typeof STATUSES)[number];

/**
 * Allowed transitions and who may make them. Publishing is recorded by a person here;
 * automatic publishing through integrations arrives with MCP (M11) and always needs approval.
 */
const TRANSITIONS: Record<Status, Partial<Record<Status, "content:write" | "content:approve">>> = {
  draft: { in_review: "content:write", approved: "content:approve", rejected: "content:approve" },
  in_review: { draft: "content:write", approved: "content:approve", rejected: "content:approve" },
  approved: { draft: "content:write", scheduled: "content:approve", published: "content:approve" },
  scheduled: { approved: "content:approve", published: "content:approve" },
  rejected: { draft: "content:write" },
  published: {},
};

const listQuery = z.object({
  type: z.string().optional().transform((v) => (v ? v.split(",") : undefined)).pipe(z.array(z.enum(CONTENT_TYPES)).optional()),
  status: z.enum(STATUSES).optional(),
  language: z.enum(CONTENT_LANGUAGES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

const createBody = z
  .object({
    type: z.enum(CONTENT_TYPES),
    data: z.record(z.string(), z.unknown()),
    language: z.enum(CONTENT_LANGUAGES),
    platform: z.enum(CONTENT_PLATFORMS).optional(),
    title: z.string().trim().max(200).optional(),
  })
  .transform((v, ctx) => {
    const parsed = CONTENT_FORMATS[v.type].safeParse(v.data);
    if (!parsed.success) {
      for (const i of parsed.error.issues) ctx.addIssue({ code: "custom", path: ["data", ...i.path.map(String)], message: i.message });
      return z.NEVER;
    }
    return { ...v, data: parsed.data as Record<string, unknown> };
  });

const patchBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().min(1).max(30_000).optional(),
    language: z.enum(CONTENT_LANGUAGES).optional(),
    platform: z.enum(CONTENT_PLATFORMS).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

const statusBody = z.object({
  status: z.enum(STATUSES),
  note: z.string().max(1000).optional(),
  scheduledFor: z.string().datetime({ offset: true }).optional(),
  publishedUrl: z.string().url().max(500).optional(),
});

type ItemData = { format: Record<string, unknown>; checks: unknown[]; createdBy?: string; edited?: boolean; history?: unknown[]; publishedUrl?: string };

export async function contentRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const active = isNull(schema.contentItems.deletedAt);

  app.get("/api/content", { preHandler: requireAuth("content:read") }, async (req) => {
    const q = parse(listQuery, req.query);
    const rows = await db
      .select({
        id: schema.contentItems.id, type: schema.contentItems.type, platform: schema.contentItems.platform, language: schema.contentItems.language,
        title: schema.contentItems.title, status: schema.contentItems.status, scheduledFor: schema.contentItems.scheduledFor,
        publishedAt: schema.contentItems.publishedAt, createdAt: schema.contentItems.createdAt, sourceTaskId: schema.contentItems.sourceTaskId,
        preview: sql<string>`left(${schema.contentItems.body}, 220)`,
        checkCount: sql<number>`coalesce(jsonb_array_length(${schema.contentItems.data}->'checks'), 0)::int`,
      })
      .from(schema.contentItems)
      .where(
        and(
          active,
          q.type ? sql`${schema.contentItems.type} in ${q.type}` : undefined,
          q.status ? eq(schema.contentItems.status, q.status) : undefined,
          q.language ? eq(schema.contentItems.language, q.language) : undefined,
          q.q ? sql`(${schema.contentItems.title} ilike ${`%${q.q}%`} or ${schema.contentItems.body} ilike ${`%${q.q}%`})` : undefined,
        ),
      )
      .orderBy(desc(schema.contentItems.createdAt))
      .limit(q.limit);
    return { items: rows };
  });

  /** Items scheduled or published within a month (Pakistan time). */
  app.get("/api/content/calendar", { preHandler: requireAuth("content:read") }, async (req) => {
    const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), req.query);
    const start = sql`(${`${month}-01`}::date)::timestamp at time zone 'Asia/Karachi'`;
    const end = sql`((${`${month}-01`}::date + interval '1 month')::timestamp) at time zone 'Asia/Karachi'`;
    const when = sql`coalesce(${schema.contentItems.publishedAt}, ${schema.contentItems.scheduledFor})`;
    const rows = await db
      .select({ id: schema.contentItems.id, type: schema.contentItems.type, platform: schema.contentItems.platform, title: schema.contentItems.title, status: schema.contentItems.status, at: sql<string>`${when}` })
      .from(schema.contentItems)
      .where(and(active, sql`${when} >= ${start} and ${when} < ${end}`))
      .orderBy(when);
    return { month, timezone: "Asia/Karachi", items: rows };
  });

  app.get("/api/content/:id", { preHandler: requireAuth("content:read") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [item] = await db.select().from(schema.contentItems).where(and(eq(schema.contentItems.id, id), active));
    if (!item) throw notFound("Content");
    return { item };
  });

  app.post("/api/content", { preHandler: requireAuth("content:write") }, async (req, reply) => {
    const body = parse(createBody, req.body);
    const item = await saveContentDraft(db, { ...body, createdBy: "user" });
    await writeAudit(db, { ...auditMeta(req), action: "content.create", entityType: "content_item", entityId: item.id, metadata: { type: body.type } });
    return reply.code(201).send({ item });
  });

  /** Manual edit of the text. Editing approved content sends it back to review. */
  app.patch("/api/content/:id", { preHandler: requireAuth("content:write") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(patchBody, req.body);
    const [item] = await db.select().from(schema.contentItems).where(and(eq(schema.contentItems.id, id), active));
    if (!item) throw notFound("Content");
    if (item.status === "published") throw conflict("Published content can't be edited");
    const data = item.data as ItemData;
    const text = body.body ?? item.body ?? contentText(item.type as ContentType, data.format);
    const language = body.language ?? item.language;
    const checks = runContentChecks(item.type as ContentType, language, text, data.format, item.sources.length > 0);
    const backToReview = ["approved", "scheduled"].includes(item.status) && (body.body !== undefined || body.language !== undefined);
    const [updated] = await db
      .update(schema.contentItems)
      .set({
        ...body,
        body: text,
        data: { ...data, checks, edited: data.edited || body.body !== undefined },
        ...(backToReview ? { status: "in_review" as const, scheduledFor: null } : {}),
      })
      .where(eq(schema.contentItems.id, id))
      .returning();
    await writeAudit(db, { ...auditMeta(req), action: "content.edit", entityType: "content_item", entityId: id, metadata: { changed: Object.keys(body), backToReview } });
    return { item: updated };
  });

  app.post("/api/content/:id/status", { preHandler: requireAuth("content:read") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(statusBody, req.body);
    const [item] = await db.select().from(schema.contentItems).where(and(eq(schema.contentItems.id, id), active));
    if (!item) throw notFound("Content");
    const from = item.status as Status;
    const needed = TRANSITIONS[from][body.status];
    if (!needed) throw new HttpError(409, "INVALID_TRANSITION", `Can't move content from ${from} to ${body.status}`);
    if (!hasPermission(req.auth!.user.role, needed)) throw forbidden(needed === "content:approve" ? "Only the owner or an admin can approve, schedule or publish content" : undefined);
    if (body.status === "scheduled" && !body.scheduledFor) throw new HttpError(400, "VALIDATION_ERROR", "scheduledFor is required to schedule");
    if (body.status === "scheduled" && new Date(body.scheduledFor!) < new Date()) throw new HttpError(400, "VALIDATION_ERROR", "scheduledFor must be in the future");

    const data = item.data as ItemData;
    const history = [...((data.history as unknown[]) ?? []), { from, to: body.status, by: req.auth!.user.id, at: new Date().toISOString(), note: body.note ?? null }];
    const [updated] = await db
      .update(schema.contentItems)
      .set({
        status: body.status,
        data: { ...data, history, ...(body.publishedUrl ? { publishedUrl: body.publishedUrl } : {}) },
        ...(body.status === "scheduled" ? { scheduledFor: new Date(body.scheduledFor!) } : {}),
        ...(body.status === "approved" || body.status === "draft" ? { scheduledFor: null } : {}),
        ...(body.status === "published" ? { publishedAt: new Date() } : {}),
      })
      .where(eq(schema.contentItems.id, id))
      .returning();
    await writeAudit(db, { ...auditMeta(req), action: `content.${body.status}`, entityType: "content_item", entityId: id, metadata: { from, note: body.note ?? null } });
    return { item: updated };
  });

  app.delete("/api/content/:id", { preHandler: requireAuth("content:write") }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [row] = await db
      .update(schema.contentItems)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.contentItems.id, id), active, sql`${schema.contentItems.status} <> 'published'`))
      .returning({ id: schema.contentItems.id });
    if (!row) throw notFound("Unpublished content");
    await writeAudit(db, { ...auditMeta(req), action: "content.delete", entityType: "content_item", entityId: id });
    return reply.code(204).send();
  });
}
