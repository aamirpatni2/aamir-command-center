import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  and, asc, courseCatalog, desc, enrollmentProgress, eq, inArray, InvalidPhoneError, isNull, issueCertificate,
  notInArray, schema, sql, upsertContactByPhone, writeAudit, type Database,
} from "@acc/database";
import { CERTIFICATE_RULES, CERTIFICATE_RULES_VERSION, CONTENT_LANGUAGES } from "@acc/shared";
import { conflict, HttpError, notFound, parse } from "../lib/errors.js";
import { auditMeta } from "../lib/audit.js";
import { requireAuth } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });
const money = z.number().int().min(0).max(100_000_000_00);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const isoDateTime = z.string().datetime({ offset: true });

const courseBody = z.object({
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/, "lowercase letters, digits and -"),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  level: z.string().trim().max(50).nullable().optional(),
  language: z.enum(CONTENT_LANGUAGES).default("ur"),
  priceMinor: money.nullable().optional(),
  currency: z.string().length(3).default("PKR"),
  durationWeeks: z.number().int().min(1).max(104).nullable().optional(),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
});

const batchFields = z.object({
    name: z.string().trim().min(1).max(120),
    startsOn: date.nullable().optional(),
    endsOn: date.nullable().optional(),
    schedule: z.array(z.object({ day: z.string().max(20), time: z.string().max(20), tz: z.string().max(40).default("Asia/Karachi") })).max(14).nullable().optional(),
    capacity: z.number().int().min(1).max(10_000).nullable().optional(),
    status: z.enum(["planned", "enrolling", "running", "completed", "cancelled"]).default("planned"),
    priceMinor: money.nullable().optional(),
    earlyBirdPriceMinor: money.nullable().optional(),
    earlyBirdUntil: date.nullable().optional(),
});
const batchBody = batchFields
  .refine((b) => !b.startsOn || !b.endsOn || b.endsOn >= b.startsOn, { message: "endsOn must be after startsOn", path: ["endsOn"] })
  .refine((b) => (b.earlyBirdPriceMinor == null) === (b.earlyBirdUntil == null), { message: "Early-bird needs both a price and a date", path: ["earlyBirdUntil"] });

const enrollBody = z.object({
  batchId: z.string().uuid(),
  phone: z.string().trim().min(5).max(30),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
});

const paymentBody = z.object({
  amountMinor: money.refine((v) => v > 0, "must be positive"),
  method: z.enum(["bank_transfer", "jazzcash", "easypaisa", "card", "cash", "other"]),
  reference: z.string().trim().min(1).max(120).optional(),
  paidAt: isoDateTime.optional(),
});

const classBody = z.object({
  title: z.string().trim().min(1).max(200),
  startsAt: isoDateTime,
  durationMin: z.number().int().min(10).max(600).default(90),
  meetingUrl: z.string().url().max(500).nullable().optional(),
});
const classPatch = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    startsAt: isoDateTime.optional(),
    durationMin: z.number().int().min(10).max(600).optional(),
    meetingUrl: z.string().url().max(500).nullable().optional(),
    recordingUrl: z.string().url().max(500).nullable().optional(),
    recordingStatus: z.enum(["none", "processing", "available"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

const attendanceBody = z.object({ attendance: z.record(z.string().uuid(), z.enum(["present", "absent", "late"])) });

const assignmentBody = z.object({
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(10_000).nullable().optional(),
  dueAt: isoDateTime.nullable().optional(),
  maxScore: z.number().int().min(1).max(1000).nullable().optional(),
  classId: z.string().uuid().nullable().optional(),
});
const submissionBody = z.object({
  status: z.enum(["pending", "submitted", "late", "graded", "missing"]),
  score: z.number().int().min(0).max(1000).nullable().optional(),
  feedback: z.string().max(5000).nullable().optional(),
  submissionUrl: z.string().url().max(500).nullable().optional(),
});

const pgCode = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
const toDate = (s: string | null | undefined) => (s === undefined ? undefined : s === null ? null : new Date(s));

export async function educationRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const audit = (req: FastifyRequest, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) =>
    writeAudit(db, { ...auditMeta(req), action, entityType, entityId, metadata });

  // ── Courses & batches ────────────────────────────────────────────────
  app.get("/api/courses", { preHandler: requireAuth("courses:read") }, async () => ({ courses: await courseCatalog(db, { includeDraft: true }) }));

  app.post("/api/courses", { preHandler: requireAuth("courses:write") }, async (req, reply) => {
    const body = parse(courseBody, req.body);
    try {
      const [course] = await db.insert(schema.courses).values(body).returning();
      await audit(req, "course.create", "course", course!.id);
      return reply.code(201).send({ course });
    } catch (e) {
      if (pgCode(e) === "23505") throw conflict("A course with this slug already exists");
      throw e;
    }
  });

  app.patch("/api/courses/:id", { preHandler: requireAuth("courses:write") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(courseBody.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update"), req.body);
    const [course] = await db.update(schema.courses).set(body).where(and(eq(schema.courses.id, id), isNull(schema.courses.deletedAt))).returning();
    if (!course) throw notFound("Course");
    await audit(req, "course.update", "course", id, { changed: Object.keys(body) });
    return { course };
  });

  app.post("/api/courses/:id/batches", { preHandler: requireAuth("courses:write") }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(batchBody, req.body);
    const [course] = await db.select({ id: schema.courses.id }).from(schema.courses).where(and(eq(schema.courses.id, id), isNull(schema.courses.deletedAt)));
    if (!course) throw notFound("Course");
    const [batch] = await db.insert(schema.courseBatches).values({ ...body, courseId: id }).returning();
    await audit(req, "batch.create", "course_batch", batch!.id);
    return reply.code(201).send({ batch });
  });

  app.patch("/api/batches/:id", { preHandler: requireAuth("courses:write") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(batchFields.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update"), req.body);
    const [batch] = await db.update(schema.courseBatches).set(body).where(and(eq(schema.courseBatches.id, id), isNull(schema.courseBatches.deletedAt))).returning();
    if (!batch) throw notFound("Batch");
    await audit(req, "batch.update", "course_batch", id, { changed: Object.keys(body) });
    return { batch };
  });

  app.get("/api/batches/:id", { preHandler: requireAuth("courses:read") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [row] = await db
      .select({ batch: schema.courseBatches, course: schema.courses })
      .from(schema.courseBatches)
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseBatches.courseId))
      .where(and(eq(schema.courseBatches.id, id), isNull(schema.courseBatches.deletedAt)));
    if (!row) throw notFound("Batch");
    const roster = await db
      .select({ enrollmentId: schema.enrollments.id, studentId: schema.students.id, status: schema.enrollments.status, name: schema.contacts.name, phone: schema.contacts.phone })
      .from(schema.enrollments)
      .innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.students.contactId))
      .where(eq(schema.enrollments.batchId, id))
      .orderBy(asc(schema.contacts.name));
    const progress = await enrollmentProgress(db, roster.map((r) => r.enrollmentId));
    const classes = await db.select().from(schema.classes).where(eq(schema.classes.batchId, id)).orderBy(asc(schema.classes.startsAt));
    const assignments = await db.select().from(schema.assignments).where(eq(schema.assignments.batchId, id)).orderBy(asc(schema.assignments.dueAt));
    return { ...row, roster: roster.map((r) => ({ ...r, progress: progress.get(r.enrollmentId) })), classes, assignments };
  });

  // ── Students & enrollments ──────────────────────────────────────────
  app.get("/api/students", { preHandler: requireAuth("students:read") }, async (req) => {
    const q = parse(z.object({ batchId: z.string().uuid().optional(), q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    const rows = await db
      .select({
        enrollmentId: schema.enrollments.id, enrollmentStatus: schema.enrollments.status, certificateStatus: schema.enrollments.certificateStatus,
        studentId: schema.students.id, name: schema.contacts.name, phone: schema.contacts.phone,
        batchId: schema.courseBatches.id, batchName: schema.courseBatches.name, courseTitle: schema.courses.title,
      })
      .from(schema.enrollments)
      .innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.students.contactId))
      .innerJoin(schema.courseBatches, eq(schema.courseBatches.id, schema.enrollments.batchId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseBatches.courseId))
      .where(
        and(
          isNull(schema.students.deletedAt),
          q.batchId ? eq(schema.enrollments.batchId, q.batchId) : undefined,
          q.q ? sql`(${schema.contacts.name} ilike ${`%${q.q}%`} or ${schema.contacts.phone} like ${`%${q.q.replace(/\D/g, "") || q.q}%`})` : undefined,
        ),
      )
      .orderBy(desc(schema.enrollments.createdAt))
      .limit(q.limit);
    const progress = await enrollmentProgress(db, rows.map((r) => r.enrollmentId));
    return { students: rows.map((r) => ({ ...r, progress: progress.get(r.enrollmentId) })) };
  });

  /** Enrol someone (new or existing contact) into a batch. */
  app.post("/api/enrollments", { preHandler: requireAuth("students:write") }, async (req, reply) => {
    const body = parse(enrollBody, req.body);
    const [batch] = await db.select().from(schema.courseBatches).where(and(eq(schema.courseBatches.id, body.batchId), isNull(schema.courseBatches.deletedAt)));
    if (!batch) throw notFound("Batch");
    if (["completed", "cancelled"].includes(batch.status)) throw conflict(`Batch is ${batch.status}`);
    try {
      const result = await db.transaction(async (tx) => {
        const { contact } = await upsertContactByPhone(tx, { phone: body.phone, name: body.name, email: body.email });
        let [student] = await tx.select().from(schema.students).where(and(eq(schema.students.contactId, contact.id), isNull(schema.students.deletedAt)));
        if (!student) [student] = await tx.insert(schema.students).values({ contactId: contact.id }).returning();
        if (batch.capacity != null) {
          const [{ n } = { n: 0 }] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(schema.enrollments)
            .where(and(eq(schema.enrollments.batchId, batch.id), inArray(schema.enrollments.status, ["pending", "active", "completed"])));
          if (n >= batch.capacity) throw conflict("This batch is full");
        }
        const [enrollment] = await tx.insert(schema.enrollments).values({ studentId: student!.id, batchId: batch.id, status: "pending", enrolledAt: new Date() }).returning();
        // Link to the sales pipeline: the open lead becomes "negotiating" until payment is verified.
        const [lead] = await tx
          .select({ id: schema.leads.id })
          .from(schema.leads)
          .where(and(eq(schema.leads.contactId, contact.id), isNull(schema.leads.deletedAt), notInArray(schema.leads.status, ["won", "lost"])));
        if (lead) await tx.update(schema.leads).set({ status: "negotiating" }).where(eq(schema.leads.id, lead.id));
        return { contact, student: student!, enrollment: enrollment! };
      });
      await audit(req, "enrollment.create", "enrollment", result.enrollment.id, { batchId: batch.id });
      return reply.code(201).send(result);
    } catch (e) {
      if (e instanceof InvalidPhoneError) throw new HttpError(400, "VALIDATION_ERROR", e.message);
      if (pgCode(e) === "23505") throw conflict("This student is already enrolled in this batch");
      throw e;
    }
  });

  app.get("/api/students/:id", { preHandler: requireAuth("students:read") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [row] = await db
      .select({ student: schema.students, contact: schema.contacts })
      .from(schema.students)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.students.contactId))
      .where(and(eq(schema.students.id, id), isNull(schema.students.deletedAt)));
    if (!row) throw notFound("Student");
    const ens = await db
      .select({ enrollment: schema.enrollments, batchName: schema.courseBatches.name, courseTitle: schema.courses.title })
      .from(schema.enrollments)
      .innerJoin(schema.courseBatches, eq(schema.courseBatches.id, schema.enrollments.batchId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseBatches.courseId))
      .where(eq(schema.enrollments.studentId, id))
      .orderBy(desc(schema.enrollments.createdAt));
    const ids = ens.map((e) => e.enrollment.id);
    const progress = await enrollmentProgress(db, ids);
    const pays = ids.length ? await db.select().from(schema.payments).where(inArray(schema.payments.enrollmentId, ids)).orderBy(desc(schema.payments.createdAt)) : [];
    const [lead] = await db.select({ id: schema.leads.id, status: schema.leads.status }).from(schema.leads).where(and(eq(schema.leads.contactId, row.contact.id), isNull(schema.leads.deletedAt))).orderBy(desc(schema.leads.createdAt)).limit(1);
    return {
      ...row,
      lead: lead ?? null,
      enrollments: ens.map((e) => ({ ...e.enrollment, batchName: e.batchName, courseTitle: e.courseTitle, progress: progress.get(e.enrollment.id), payments: pays.filter((p) => p.enrollmentId === e.enrollment.id) })),
      certificateRules: { version: CERTIFICATE_RULES_VERSION, ...CERTIFICATE_RULES },
    };
  });

  app.patch("/api/enrollments/:id", { preHandler: requireAuth("students:write") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ status: z.enum(["pending", "active", "completed", "dropped", "refunded"]) }), req.body);
    const [enrollment] = await db.update(schema.enrollments).set(body).where(eq(schema.enrollments.id, id)).returning();
    if (!enrollment) throw notFound("Enrollment");
    await audit(req, "enrollment.update", "enrollment", id, body);
    return { enrollment };
  });

  // ── Payments ─────────────────────────────────────────────────────────
  app.post("/api/enrollments/:id/payments", { preHandler: requireAuth("payments:write") }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(paymentBody, req.body);
    const [enrollment] = await db.select({ id: schema.enrollments.id }).from(schema.enrollments).where(eq(schema.enrollments.id, id));
    if (!enrollment) throw notFound("Enrollment");
    try {
      const [payment] = await db
        .insert(schema.payments)
        .values({ enrollmentId: id, amountMinor: body.amountMinor, method: body.method, reference: body.reference ?? null, paidAt: body.paidAt ? new Date(body.paidAt) : new Date(), status: "pending" })
        .returning();
      await audit(req, "payment.record", "payment", payment!.id, { amountMinor: body.amountMinor, method: body.method });
      return reply.code(201).send({ payment });
    } catch (e) {
      if (pgCode(e) === "23505") throw conflict("A payment with this method and reference already exists (possible duplicate)");
      throw e;
    }
  });

  /** A person confirms the money arrived. Activates the enrollment and closes the lead as won. */
  app.post("/api/payments/:id/verify", { preHandler: requireAuth("payments:verify") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const result = await db.transaction(async (tx) => {
      const [payment] = await tx
        .update(schema.payments)
        .set({ status: "verified", verifiedBy: req.auth!.user.id })
        .where(and(eq(schema.payments.id, id), eq(schema.payments.status, "pending")))
        .returning();
      if (!payment) return null;
      if (payment.enrollmentId) {
        const [en] = await tx
          .update(schema.enrollments)
          .set({ status: "active" })
          .where(and(eq(schema.enrollments.id, payment.enrollmentId), eq(schema.enrollments.status, "pending")))
          .returning();
        const [contact] = await tx
          .select({ contactId: schema.students.contactId })
          .from(schema.enrollments)
          .innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
          .where(eq(schema.enrollments.id, payment.enrollmentId));
        if (contact) {
          await tx
            .update(schema.leads)
            .set({ status: "won" })
            .where(and(eq(schema.leads.contactId, contact.contactId), isNull(schema.leads.deletedAt), notInArray(schema.leads.status, ["won", "lost"])));
        }
        return { payment, activated: !!en };
      }
      return { payment, activated: false };
    });
    if (!result) {
      const [exists] = await db.select({ status: schema.payments.status }).from(schema.payments).where(eq(schema.payments.id, id));
      if (!exists) throw notFound("Payment");
      throw conflict(`Payment is already ${exists.status}`);
    }
    await audit(req, "payment.verify", "payment", id, { amountMinor: result.payment.amountMinor, activated: result.activated });
    return result;
  });

  // ── Classes, attendance, assignments ────────────────────────────────
  app.get("/api/classes", { preHandler: requireAuth("students:read") }, async (req) => {
    const q = parse(z.object({ batchId: z.string().uuid().optional(), upcoming: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    const rows = await db
      .select({ cls: schema.classes, batchName: schema.courseBatches.name, courseTitle: schema.courses.title })
      .from(schema.classes)
      .innerJoin(schema.courseBatches, eq(schema.courseBatches.id, schema.classes.batchId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseBatches.courseId))
      .where(and(q.batchId ? eq(schema.classes.batchId, q.batchId) : undefined, q.upcoming === "true" ? sql`${schema.classes.startsAt} >= now() - interval '3 hours'` : undefined))
      .orderBy(q.upcoming === "true" ? asc(schema.classes.startsAt) : desc(schema.classes.startsAt))
      .limit(q.limit);
    return {
      classes: rows.map((r) => {
        const vals = Object.values(r.cls.attendance);
        return { ...r.cls, batchName: r.batchName, courseTitle: r.courseTitle, attendanceSummary: { present: vals.filter((v) => v === "present").length, late: vals.filter((v) => v === "late").length, absent: vals.filter((v) => v === "absent").length } };
      }),
    };
  });

  app.post("/api/batches/:id/classes", { preHandler: requireAuth("students:write") }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(classBody, req.body);
    const [batch] = await db.select({ id: schema.courseBatches.id }).from(schema.courseBatches).where(eq(schema.courseBatches.id, id));
    if (!batch) throw notFound("Batch");
    const [cls] = await db.insert(schema.classes).values({ ...body, batchId: id, startsAt: new Date(body.startsAt) }).returning();
    await audit(req, "class.create", "class", cls!.id);
    return reply.code(201).send({ class: cls });
  });

  app.patch("/api/classes/:id", { preHandler: requireAuth("students:write") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(classPatch, req.body);
    const { startsAt, ...rest } = body;
    const [cls] = await db.update(schema.classes).set({ ...rest, ...(startsAt ? { startsAt: new Date(startsAt) } : {}) }).where(eq(schema.classes.id, id)).returning();
    if (!cls) throw notFound("Class");
    await audit(req, "class.update", "class", id, { changed: Object.keys(body) });
    return { class: cls };
  });

  app.put("/api/classes/:id/attendance", { preHandler: requireAuth("students:write") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { attendance } = parse(attendanceBody, req.body);
    const [cls] = await db.select().from(schema.classes).where(eq(schema.classes.id, id));
    if (!cls) throw notFound("Class");
    const ids = Object.keys(attendance);
    if (ids.length) {
      const valid = await db.select({ id: schema.enrollments.id }).from(schema.enrollments).where(and(eq(schema.enrollments.batchId, cls.batchId), inArray(schema.enrollments.id, ids)));
      const bad = ids.filter((x) => !valid.some((v) => v.id === x));
      if (bad.length) throw new HttpError(400, "VALIDATION_ERROR", "Some enrollments are not in this class's batch", bad);
    }
    const [updated] = await db
      .update(schema.classes)
      .set({ attendance: sql`${schema.classes.attendance} || ${JSON.stringify(attendance)}::jsonb` })
      .where(eq(schema.classes.id, id))
      .returning();
    await audit(req, "class.attendance", "class", id, { marked: ids.length });
    return { class: updated };
  });

  app.post("/api/batches/:id/assignments", { preHandler: requireAuth("students:write") }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(assignmentBody, req.body);
    const [batch] = await db.select({ id: schema.courseBatches.id }).from(schema.courseBatches).where(eq(schema.courseBatches.id, id));
    if (!batch) throw notFound("Batch");
    const [assignment] = await db.insert(schema.assignments).values({ ...body, batchId: id, dueAt: toDate(body.dueAt) }).returning();
    await audit(req, "assignment.create", "assignment", assignment!.id);
    return reply.code(201).send({ assignment });
  });

  app.put("/api/assignments/:id/submissions/:enrollmentId", { preHandler: requireAuth("students:write") }, async (req) => {
    const { id, enrollmentId } = parse(z.object({ id: z.string().uuid(), enrollmentId: z.string().uuid() }), req.params);
    const body = parse(submissionBody, req.body);
    const [pair] = await db
      .select({ a: schema.assignments.id })
      .from(schema.assignments)
      .innerJoin(schema.enrollments, eq(schema.enrollments.batchId, schema.assignments.batchId))
      .where(and(eq(schema.assignments.id, id), eq(schema.enrollments.id, enrollmentId)));
    if (!pair) throw notFound("Assignment/enrollment in the same batch");
    const values = { ...body, submittedAt: ["submitted", "late", "graded"].includes(body.status) ? new Date() : null };
    const [submission] = await db
      .insert(schema.assignmentSubmissions)
      .values({ assignmentId: id, enrollmentId, ...values })
      .onConflictDoUpdate({ target: [schema.assignmentSubmissions.assignmentId, schema.assignmentSubmissions.enrollmentId], set: values })
      .returning();
    return { submission };
  });

  // ── Certificates ─────────────────────────────────────────────────────
  app.post("/api/enrollments/:id/certificate", { preHandler: requireAuth("certificates:issue") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ certificateUrl: z.string().url().max(500).optional() }), req.body ?? {});
    const result = await issueCertificate(db, id, body.certificateUrl);
    if (result.status === "not_found") throw notFound("Enrollment");
    if (result.status === "already_issued") throw conflict("Certificate already issued");
    if (result.status === "not_eligible") throw new HttpError(409, "NOT_ELIGIBLE", "Not eligible for a certificate yet", result.failing);
    const enrollment = result.enrollment;
    await audit(req, "certificate.issue", "enrollment", id, { rules: CERTIFICATE_RULES_VERSION });
    return { enrollment };
  });
}
