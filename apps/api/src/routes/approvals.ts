import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ApprovalError, approveApproval, editableFieldsFor, editApproval, executeApproval, expireStaleApprovals, rejectApproval,
  type ApprovalDeps, type ApprovalRow, type OAuthService, type TaskEventSink, type WhatsAppClient,
} from "@acc/agents";
import { desc, eq, inArray, schema, sql, type Database } from "@acc/database";
import { APPROVAL_STATUSES, hasPermission, type Role } from "@acc/shared";
import { forbidden, HttpError, notFound, parse } from "../lib/errors.js";
import { auditMeta } from "../lib/audit.js";
import { requireAuth } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });
const STATUS_GROUPS = {
  open: ["pending", "approved", "executing"],
  decided: ["executed", "rejected", "expired", "failed"],
} as const;
const listQuery = z.object({
  status: z.enum(["open", "decided", "all", ...APPROVAL_STATUSES]).default("open"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const editsSchema = z.record(z.string(), z.unknown()).refine((o) => Object.keys(o).length > 0, "No changes given");
const approveBody = z.object({ note: z.string().trim().max(500).optional(), edits: editsSchema.optional() });
const rejectBody = z.object({ note: z.string().trim().max(500).optional() });

const canDecide = (role: Role, risk: string) => hasPermission(role, risk === "financial" ? "approvals:decide_financial" : "approvals:decide");

function toHttp(e: unknown): never {
  if (e instanceof ApprovalError) {
    const status = e.code === "NOT_FOUND" ? 404 : e.code === "INVALID_EDIT" ? 400 : 409;
    throw new HttpError(status, e.code, e.message, e.details);
  }
  throw e;
}

interface Context {
  contactName?: string | null;
  contactPhone?: string | null;
  conversationId?: string | null;
  studentId?: string | null;
  course?: string | null;
  lastInboundAt?: Date | null;
  lastInboundText?: string | null;
}

/** Who the action affects, and whether WhatsApp's 24h window is open — shown next to every request. */
async function loadContext(db: Database, rows: ApprovalRow[]): Promise<Map<string, Context>> {
  const out = new Map<string, Context>();
  const eff = (r: ApprovalRow) => (r.editedPayload ?? r.payload) as Record<string, string | undefined>;
  const convIds = new Set<string>();
  const studentIds = new Set<string>();
  const enrollmentIds = new Set<string>();
  for (const r of rows) {
    const p = eff(r);
    if ((r.toolName === "whatsapp.send" || r.toolName === "whatsapp.send_template") && p.conversationId) convIds.add(p.conversationId);
    if (r.toolName === "student.message" && p.studentId) studentIds.add(p.studentId);
    if (r.toolName === "certificate.request" && p.enrollmentId) enrollmentIds.add(p.enrollmentId);
  }

  const students = studentIds.size
    ? await db
        .select({
          studentId: schema.students.id, name: schema.contacts.name, phone: schema.contacts.phone,
          conversationId: sql<string | null>`(select c.id from conversations c where c.contact_id = "students"."contact_id" and c.channel = 'whatsapp' order by c.last_message_at desc nulls last limit 1)`,
        })
        .from(schema.students)
        .innerJoin(schema.contacts, eq(schema.contacts.id, schema.students.contactId))
        .where(inArray(schema.students.id, [...studentIds]))
    : [];
  for (const s of students) if (s.conversationId) convIds.add(s.conversationId);

  const convs = convIds.size
    ? await db
        .select({
          id: schema.conversations.id, name: schema.contacts.name, phone: schema.contacts.phone,
          lastInboundAt: sql<string | null>`(select max(m.created_at) from messages m where m.conversation_id = "conversations"."id" and m.direction = 'inbound')`,
          lastInboundText: sql<string | null>`(select left(m.body, 280) from messages m where m.conversation_id = "conversations"."id" and m.direction = 'inbound' order by m.created_at desc limit 1)`,
        })
        .from(schema.conversations)
        .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
        .where(inArray(schema.conversations.id, [...convIds]))
    : [];
  const convById = new Map(convs.map((c) => [c.id, c]));

  const enrollments = enrollmentIds.size
    ? await db
        .select({ id: schema.enrollments.id, studentId: schema.students.id, name: schema.contacts.name, phone: schema.contacts.phone, course: schema.courses.title, batch: schema.courseBatches.name })
        .from(schema.enrollments)
        .innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
        .innerJoin(schema.contacts, eq(schema.contacts.id, schema.students.contactId))
        .innerJoin(schema.courseBatches, eq(schema.courseBatches.id, schema.enrollments.batchId))
        .innerJoin(schema.courses, eq(schema.courses.id, schema.courseBatches.courseId))
        .where(inArray(schema.enrollments.id, [...enrollmentIds]))
    : [];

  const withConv = (id: string | null | undefined): Context => {
    const c = id ? convById.get(id) : undefined;
    return c
      ? { conversationId: c.id, contactName: c.name, contactPhone: c.phone, lastInboundAt: c.lastInboundAt ? new Date(c.lastInboundAt) : null, lastInboundText: c.lastInboundText }
      : {};
  };
  for (const r of rows) {
    const p = eff(r);
    if (r.toolName === "whatsapp.send" || r.toolName === "whatsapp.send_template") out.set(r.id, withConv(p.conversationId));
    else if (r.toolName === "student.message") {
      const s = students.find((x) => x.studentId === p.studentId);
      out.set(r.id, { contactName: s?.name ?? null, contactPhone: s?.phone ?? null, studentId: p.studentId ?? null, ...withConv(s?.conversationId) });
    } else if (r.toolName === "certificate.request") {
      const e = enrollments.find((x) => x.id === p.enrollmentId);
      out.set(r.id, e ? { contactName: e.name, contactPhone: e.phone, studentId: e.studentId, course: `${e.course} · ${e.batch}` } : {});
    }
  }
  return out;
}

export async function approvalRoutes(app: FastifyInstance, opts: { db: Database; whatsapp: WhatsAppClient; oauth?: OAuthService; events: TaskEventSink }) {
  const { db } = opts;
  const deps: ApprovalDeps = { db, whatsapp: opts.whatsapp, oauth: opts.oauth ?? null, events: { publish: (e) => opts.events.publish(e).catch(() => {}) } };
  const actor = (req: FastifyRequest) => ({ ...auditMeta(req), actorId: req.auth!.user.id });

  const present = async (rows: ApprovalRow[], role: Role) => {
    const context = await loadContext(db, rows);
    const taskIds = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))];
    const userIds = [...new Set(rows.map((r) => r.decidedBy).filter((x): x is string => !!x))];
    const tasks = taskIds.length ? await db.select({ id: schema.agentTasks.id, title: schema.agentTasks.title }).from(schema.agentTasks).where(inArray(schema.agentTasks.id, taskIds)) : [];
    const users = userIds.length ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, userIds)) : [];
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      taskTitle: tasks.find((t) => t.id === r.taskId)?.title ?? null,
      agent: r.requestedByAgent,
      tool: r.toolName,
      risk: r.risk,
      title: r.title,
      summary: r.summary,
      status: r.status,
      payload: r.editedPayload ?? r.payload,
      originalPayload: r.payload,
      edited: r.editedPayload !== null,
      editableFields: editableFieldsFor(r.toolName),
      decidedBy: r.decidedBy ? { id: r.decidedBy, name: users.find((u) => u.id === r.decidedBy)?.name ?? null } : null,
      decidedAt: r.decidedAt,
      decisionNote: r.decisionNote,
      executionResult: r.executionResult,
      executionAttempts: r.executionAttempts,
      executedAt: r.executedAt,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      context: context.get(r.id) ?? {},
      canDecide: canDecide(role, r.risk),
    }));
  };

  /** Loads a row and enforces the stricter permission for financial actions. */
  const loadForDecision = async (req: FastifyRequest, id: string) => {
    const [row] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, id));
    if (!row) throw notFound("Approval");
    if (!canDecide(req.auth!.user.role, row.risk)) throw forbidden("Only the owner can decide financial actions");
    return row;
  };

  app.get("/api/approvals", { preHandler: requireAuth("approvals:read") }, async (req) => {
    const q = parse(listQuery, req.query);
    await expireStaleApprovals(deps);
    const statuses: readonly string[] | null =
      q.status === "all" ? null : q.status === "open" || q.status === "decided" ? STATUS_GROUPS[q.status] : [q.status];
    const rows = await db
      .select()
      .from(schema.approvals)
      .where(statuses ? inArray(schema.approvals.status, statuses as ApprovalRow["status"][]) : undefined)
      .orderBy(q.status === "open" ? sql`${schema.approvals.createdAt} asc` : desc(schema.approvals.updatedAt))
      .limit(q.limit);
    const [counts] = await db
      .select({
        pending: sql<number>`count(*) filter (where ${schema.approvals.status} = 'pending')::int`,
        approvedNotExecuted: sql<number>`count(*) filter (where ${schema.approvals.status} = 'approved')::int`,
        executing: sql<number>`count(*) filter (where ${schema.approvals.status} = 'executing')::int`,
        failed: sql<number>`count(*) filter (where ${schema.approvals.status} = 'failed')::int`,
      })
      .from(schema.approvals);
    return { approvals: await present(rows, req.auth!.user.role), counts };
  });

  app.get("/api/approvals/:id", { preHandler: requireAuth("approvals:read") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [row] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, id));
    if (!row) throw notFound("Approval");
    const [approval] = await present([row], req.auth!.user.role);
    return { approval };
  });

  app.patch("/api/approvals/:id", { preHandler: requireAuth("approvals:decide") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ edits: editsSchema }), req.body ?? {});
    await loadForDecision(req, id);
    const row = await editApproval(db, id, body.edits, actor(req)).catch(toHttp);
    const [approval] = await present([row], req.auth!.user.role);
    return { approval };
  });

  app.post("/api/approvals/:id/approve", { preHandler: requireAuth("approvals:decide") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(approveBody, req.body ?? {});
    await loadForDecision(req, id);
    const { approval: row, outcome } = await approveApproval(deps, id, { note: body.note ?? null, edits: body.edits }, actor(req)).catch(toHttp);
    const [approval] = await present([row], req.auth!.user.role);
    return { approval, outcome };
  });

  /** Retry an approved action that did not execute (e.g. WhatsApp wasn't configured yet). */
  app.post("/api/approvals/:id/execute", { preHandler: requireAuth("approvals:decide") }, async (req) => {
    const { id } = parse(idParam, req.params);
    await loadForDecision(req, id);
    const { approval: row, outcome } = await executeApproval(deps, id, actor(req)).catch(toHttp);
    const [approval] = await present([row], req.auth!.user.role);
    return { approval, outcome };
  });

  app.post("/api/approvals/:id/reject", { preHandler: requireAuth("approvals:decide") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(rejectBody, req.body ?? {});
    await loadForDecision(req, id);
    const row = await rejectApproval(deps, id, body.note ?? null, actor(req)).catch(toHttp);
    const [approval] = await present([row], req.auth!.user.role);
    return { approval };
  });
}
