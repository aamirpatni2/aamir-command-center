import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createWhatsappTriageTask, modelAvailability, type TaskQueue } from "@acc/agents";
import type { Env } from "@acc/config";
import {
  and, asc, desc, eq, getOrCreateOpenLead, InvalidPhoneError, isNull, mergeLeadSignals, or, recalculateLeadScore,
  schema, sql, upsertContactByPhone, writeAudit, type Database,
} from "@acc/database";
import { BANDS, LEAD_STATUSES, SCORING_RULES, SCORING_VERSION } from "@acc/shared";
import { HttpError, notFound, parse } from "../lib/errors.js";
import { auditMeta } from "../lib/audit.js";
import { requireAuth } from "../plugins/auth.js";

export interface CrmRouteOptions {
  db: Database;
  env: Env;
  queue: TaskQueue;
}

const idParam = z.object({ id: z.string().uuid() });
const bandSql = (b: "hot" | "warm" | "cold") =>
  b === "hot" ? sql`${schema.leads.score} >= ${BANDS.hot}` : b === "warm" ? sql`${schema.leads.score} between ${BANDS.warm} and ${BANDS.hot - 1}` : sql`${schema.leads.score} < ${BANDS.warm}`;
const band = (score: number) => (score >= BANDS.hot ? "hot" : score >= BANDS.warm ? "warm" : "cold");

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  band: z.enum(["hot", "warm", "cold"]).optional(),
  due: z.enum(["today"]).optional(),
  sort: z.enum(["score", "followup", "recent"]).default("score"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createLead = z.object({
  phone: z.string().trim().min(5).max(30),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  source: z.string().trim().min(1).max(50).regex(/^[a-z0-9_]+$/, "lowercase letters, digits and _ only").default("manual"),
  notes: z.string().trim().max(2000).optional(),
});

const updateLead = z
  .object({
    status: z.enum(LEAD_STATUSES).optional(),
    notes: z.string().max(5000).nullable().optional(),
    nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    interestedCourseId: z.string().uuid().nullable().optional(),
    profileFit: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export async function crmRoutes(app: FastifyInstance, opts: CrmRouteOptions) {
  const { db, env, queue } = opts;

  app.get("/api/leads/scoring", { preHandler: requireAuth("leads:read") }, async () => ({
    version: SCORING_VERSION,
    rules: SCORING_RULES,
    bands: BANDS,
    status: "starter rules pending Aamir's approval",
  }));

  app.get("/api/leads", { preHandler: requireAuth("leads:read") }, async (req) => {
    const q = parse(listQuery, req.query);
    const whatsappConv = sql<string | null>`(select c.id from conversations c where c.contact_id = ${schema.leads.contactId} and c.channel = 'whatsapp' limit 1)`;
    const where = and(
      isNull(schema.leads.deletedAt),
      q.status ? eq(schema.leads.status, q.status) : undefined,
      q.band ? bandSql(q.band) : undefined,
      q.due === "today"
        ? sql`${schema.leads.nextFollowUpAt} < (date_trunc('day', now() at time zone 'Asia/Karachi') + interval '1 day') at time zone 'Asia/Karachi' and ${schema.leads.status} not in ('won','lost')`
        : undefined,
      q.q
        ? or(
            sql`${schema.contacts.name} ilike ${`%${q.q}%`}`,
            q.q.replace(/\D/g, "").length >= 3 ? sql`${schema.contacts.phone} like ${`%${q.q.replace(/\D/g, "")}%`}` : undefined,
            sql`${schema.contacts.email} ilike ${`%${q.q}%`}`,
          )
        : undefined,
    );
    const order =
      q.sort === "followup"
        ? [sql`${schema.leads.nextFollowUpAt} asc nulls last`, desc(schema.leads.score)]
        : q.sort === "recent"
          ? [sql`${schema.leads.lastInboundAt} desc nulls last`, desc(schema.leads.createdAt)]
          : [desc(schema.leads.score), sql`${schema.leads.lastInboundAt} desc nulls last`];
    const rows = await db
      .select({
        id: schema.leads.id, status: schema.leads.status, score: schema.leads.score, source: schema.leads.source,
        nextFollowUpAt: schema.leads.nextFollowUpAt, lastInboundAt: schema.leads.lastInboundAt, createdAt: schema.leads.createdAt,
        inboundMessageCount: schema.leads.inboundMessageCount,
        contactId: schema.contacts.id, name: schema.contacts.name, phone: schema.contacts.phone, email: schema.contacts.email,
        conversationId: whatsappConv,
      })
      .from(schema.leads)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.leads.contactId))
      .where(where)
      .orderBy(...order)
      .limit(q.limit)
      .offset(q.offset);
    const [{ total } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.leads)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.leads.contactId))
      .where(where);
    return { leads: rows.map((r) => ({ ...r, band: band(r.score) })), total };
  });

  app.post("/api/leads", { preHandler: requireAuth("leads:write") }, async (req, reply) => {
    const body = parse(createLead, req.body);
    try {
      const result = await db.transaction(async (tx) => {
        const { contact } = await upsertContactByPhone(tx, { phone: body.phone, name: body.name, email: body.email });
        const { lead, created } = await getOrCreateOpenLead(tx, contact.id, body.source, body.notes);
        const scored = await recalculateLeadScore(tx, lead.id);
        return { lead: scored!.lead, contact, created };
      });
      await writeAudit(db, {
        ...auditMeta(req),
        action: result.created ? "lead.create" : "lead.duplicate_merged",
        entityType: "lead",
        entityId: result.lead.id,
        metadata: { source: body.source },
      });
      return reply.code(result.created ? 201 : 200).send({ lead: { ...result.lead, band: band(result.lead.score) }, contact: result.contact, duplicate: !result.created });
    } catch (e) {
      if (e instanceof InvalidPhoneError) throw new HttpError(400, "VALIDATION_ERROR", e.message, [{ path: "phone", message: e.message }]);
      throw e;
    }
  });

  app.get("/api/leads/:id", { preHandler: requireAuth("leads:read") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [row] = await db
      .select({ lead: schema.leads, contact: schema.contacts })
      .from(schema.leads)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.leads.contactId))
      .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
    if (!row) throw notFound("Lead");
    const conversations = await db
      .select({ id: schema.conversations.id, channel: schema.conversations.channel, lastMessageAt: schema.conversations.lastMessageAt })
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, row.contact.id));
    return { lead: { ...row.lead, band: band(row.lead.score) }, contact: row.contact, conversations };
  });

  app.patch("/api/leads/:id", { preHandler: requireAuth("leads:write") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(updateLead, req.body);
    const [before] = await db.select().from(schema.leads).where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
    if (!before) throw notFound("Lead");
    const { profileFit, nextFollowUpAt, ...rest } = body;
    const patch = { ...rest, ...(nextFollowUpAt !== undefined ? { nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null } : {}) };
    try {
      if (Object.keys(patch).length) await db.update(schema.leads).set(patch).where(eq(schema.leads.id, id));
    } catch (e) {
      // Reopening a closed lead when the contact already has another open lead.
      if ((e as { cause?: { code?: string } }).cause?.code === "23505") throw new HttpError(409, "CONFLICT", "This contact already has an open lead");
      throw e;
    }
    if (profileFit !== undefined) await mergeLeadSignals(db, id, { profileFit });
    const scored = await recalculateLeadScore(db, id);
    await writeAudit(db, {
      ...auditMeta(req),
      action: "lead.update",
      entityType: "lead",
      entityId: id,
      metadata: { before: { status: before.status, nextFollowUpAt: before.nextFollowUpAt }, changed: Object.keys(body) },
    });
    return { lead: { ...scored!.lead, band: scored!.band } };
  });

  app.delete("/api/leads/:id", { preHandler: requireAuth("leads:delete") }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [row] = await db
      .update(schema.leads)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)))
      .returning({ id: schema.leads.id });
    if (!row) throw notFound("Lead");
    await writeAudit(db, { ...auditMeta(req), action: "lead.delete", entityType: "lead", entityId: id });
    return reply.code(204).send();
  });

  // ── Conversations ──────────────────────────────────────────────────────
  const pendingDrafts = (convId: unknown) =>
    sql<number>`(select count(*)::int from approvals a where a.status = 'pending' and a.tool_name = 'whatsapp.send' and a.payload->>'conversationId' = ${convId}::text)`;

  app.get("/api/conversations", { preHandler: requireAuth("leads:read") }, async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
    const rows = await db
      .select({
        id: schema.conversations.id, channel: schema.conversations.channel, status: schema.conversations.status,
        lastMessageAt: schema.conversations.lastMessageAt,
        contactName: schema.contacts.name, contactPhone: schema.contacts.phone,
        lastMessage: sql<string | null>`(select left(m.body, 140) from messages m where m.conversation_id = ${schema.conversations.id} order by m.created_at desc limit 1)`,
        lastDirection: sql<string | null>`(select m.direction from messages m where m.conversation_id = ${schema.conversations.id} order by m.created_at desc limit 1)`,
        leadId: sql<string | null>`(select l.id from leads l where l.contact_id = ${schema.conversations.contactId} and l.deleted_at is null order by l.created_at desc limit 1)`,
        leadScore: sql<number | null>`(select l.score from leads l where l.contact_id = ${schema.conversations.contactId} and l.deleted_at is null order by l.created_at desc limit 1)`,
        pendingDrafts: pendingDrafts(schema.conversations.id),
      })
      .from(schema.conversations)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
      .orderBy(sql`${schema.conversations.lastMessageAt} desc nulls last`)
      .limit(q.limit);
    return { conversations: rows.map((r) => ({ ...r, band: r.leadScore === null ? null : band(r.leadScore) })) };
  });

  app.get("/api/conversations/:id", { preHandler: requireAuth("leads:read") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [conv] = await db
      .select({ conversation: schema.conversations, contact: schema.contacts })
      .from(schema.conversations)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
      .where(eq(schema.conversations.id, id));
    if (!conv) throw notFound("Conversation");
    const msgs = await db
      .select({ id: schema.messages.id, direction: schema.messages.direction, body: schema.messages.body, media: schema.messages.media, status: schema.messages.status, sentBy: schema.messages.sentBy, createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, id))
      .orderBy(desc(schema.messages.createdAt))
      .limit(200);
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.contactId, conv.contact.id), isNull(schema.leads.deletedAt)))
      .orderBy(desc(schema.leads.createdAt))
      .limit(1);
    const drafts = await db
      .select({ id: schema.approvals.id, title: schema.approvals.title, payload: schema.approvals.payload, createdAt: schema.approvals.createdAt, taskId: schema.approvals.taskId })
      .from(schema.approvals)
      .where(and(eq(schema.approvals.status, "pending"), eq(schema.approvals.toolName, "whatsapp.send"), sql`${schema.approvals.payload}->>'conversationId' = ${id}`))
      .orderBy(asc(schema.approvals.createdAt));
    return {
      conversation: conv.conversation,
      contact: conv.contact,
      lead: lead ? { ...lead, band: band(lead.score) } : null,
      messages: msgs.reverse(),
      drafts: drafts.map((d) => ({ id: d.id, taskId: d.taskId, createdAt: d.createdAt, text: (d.payload as { text?: string }).text ?? "" })),
    };
  });

  app.post("/api/conversations/:id/triage", { preHandler: requireAuth("tasks:create") }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const availability = modelAvailability(env);
    if (!availability.available) throw new HttpError(503, "MODEL_NOT_CONFIGURED", availability.reason ?? "No model configured");
    const task = await createWhatsappTriageTask(db, id, req.auth!.user.id);
    if (!task) throw notFound("Conversation");
    await writeAudit(db, { ...auditMeta(req), action: "task.create", entityType: "agent_task", entityId: task.id, metadata: { kind: "whatsapp_triage", conversationId: id } });
    try {
      await queue.enqueue(task.id);
    } catch {
      await db.update(schema.agentTasks).set({ status: "FAILED", error: "Task queue unavailable (is Redis running?)" }).where(eq(schema.agentTasks.id, task.id));
      throw new HttpError(503, "QUEUE_UNAVAILABLE", "The task queue is unavailable. Is Redis running?");
    }
    return reply.code(202).send({ task });
  });
}
