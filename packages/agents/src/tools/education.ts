/**
 * Course and student tools. The course catalogue is the single approved source for prices and dates.
 */
import { z } from "zod";
import { and, courseCatalog, desc, enrollmentProgress, eq, isNull, schema, sql } from "@acc/database";
import type { Tool } from "./types.js";

const rupees = (minor: number | null) => (minor == null ? null : `PKR ${(minor / 100).toLocaleString("en-US")}`);

export const catalogTool: Tool<Record<string, never>, unknown> = {
  name: "course.catalog",
  description:
    "The approved course catalogue: active courses with open batches, start/end dates, class schedule, today's price " +
    "(early-bird if still open, with its deadline) and seats left. The authoritative source for prices and dates.",
  risk: "read",
  input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  async run(_input, { db }) {
    const courses = await courseCatalog(db);
    if (!courses.length) return { courses: [], note: "No active courses in the catalogue yet. Do not quote prices or dates." };
    return {
      timezone: "Asia/Karachi",
      courses: courses.map((c) => ({
        title: c.title,
        slug: c.slug,
        description: c.description,
        level: c.level,
        language: c.language,
        durationWeeks: c.durationWeeks,
        standardPrice: rupees(c.priceMinor),
        batches: c.batches.map((b) => ({
          name: b.name,
          status: b.status,
          startsOn: b.startsOn,
          endsOn: b.endsOn,
          schedule: b.schedule,
          priceToday: rupees(b.currentPriceMinor),
          regularPrice: rupees(b.priceMinor ?? c.priceMinor),
          earlyBird: b.earlyBirdPriceMinor != null ? { price: rupees(b.earlyBirdPriceMinor), until: b.earlyBirdUntil, activeToday: b.earlyBirdActive } : null,
          seatsLeft: b.seatsLeft,
        })),
      })),
    };
  },
};

const studentSearchInput = z.object({
  query: z.string().max(100).optional(),
  batchName: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export const studentSearch: Tool<z.infer<typeof studentSearchInput>, unknown> = {
  name: "student.search",
  description: "Find students by name/phone and/or batch name. Returns enrollment status, attendance %, balance due and certificate status.",
  risk: "read",
  input: studentSearchInput,
  async run({ query, batchName, limit = 25 }, { db }) {
    const rows = await db
      .select({ studentId: schema.students.id, enrollmentId: schema.enrollments.id, name: schema.contacts.name, phone: schema.contacts.phone, batch: schema.courseBatches.name, course: schema.courses.title })
      .from(schema.enrollments)
      .innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.students.contactId))
      .innerJoin(schema.courseBatches, eq(schema.courseBatches.id, schema.enrollments.batchId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseBatches.courseId))
      .where(
        and(
          isNull(schema.students.deletedAt),
          query ? sql`(${schema.contacts.name} ilike ${`%${query}%`} or ${schema.contacts.phone} like ${`%${query.replace(/\D/g, "") || query}%`})` : undefined,
          batchName ? sql`${schema.courseBatches.name} ilike ${`%${batchName}%`}` : undefined,
        ),
      )
      .orderBy(desc(schema.enrollments.createdAt))
      .limit(limit);
    const progress = await enrollmentProgress(db, rows.map((r) => r.enrollmentId));
    return {
      students: rows.map((r) => {
        const p = progress.get(r.enrollmentId)!;
        return { ...r, enrollmentStatus: p.status, attendancePct: p.attendancePct, classesHeld: p.classesHeld, balanceDue: rupees(p.balanceMinor), certificateStatus: p.certificateStatus, certificateEligible: p.certificate.eligible };
      }),
    };
  },
};

const studentGetInput = z.object({ studentId: z.string().uuid() });
export const studentGet: Tool<z.infer<typeof studentGetInput>, unknown> = {
  name: "student.get",
  description: "Full record for one student: contact, each enrollment with attendance, assignments, payments (verified vs pending), balance and certificate checks.",
  risk: "read",
  input: studentGetInput,
  async run({ studentId }, { db }) {
    const [row] = await db
      .select({ name: schema.contacts.name, phone: schema.contacts.phone })
      .from(schema.students)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.students.contactId))
      .where(and(eq(schema.students.id, studentId), isNull(schema.students.deletedAt)));
    if (!row) return { error: "Student not found" };
    const ens = await db
      .select({ id: schema.enrollments.id, batch: schema.courseBatches.name, course: schema.courses.title })
      .from(schema.enrollments)
      .innerJoin(schema.courseBatches, eq(schema.courseBatches.id, schema.enrollments.batchId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseBatches.courseId))
      .where(eq(schema.enrollments.studentId, studentId));
    const progress = await enrollmentProgress(db, ens.map((e) => e.id));
    return {
      student: row,
      enrollments: ens.map((e) => {
        const p = progress.get(e.id)!;
        return {
          enrollmentId: e.id, course: e.course, batch: e.batch, status: p.status,
          attendance: `${p.classesAttended}/${p.classesHeld} (${p.attendancePct}%)`,
          assignments: `${p.assignmentsSubmitted}/${p.assignmentsTotal}`,
          price: rupees(p.priceMinor), paidVerified: rupees(p.paidVerifiedMinor), paidPending: rupees(p.paidPendingMinor), balanceDue: rupees(p.balanceMinor),
          certificateStatus: p.certificateStatus, certificateChecks: p.certificate.checks,
        };
      }),
    };
  },
};

const studentMessageInput = z.object({ studentId: z.string().uuid(), text: z.string().min(1).max(4096), purpose: z.enum(["reminder", "support", "announcement", "payment"]) });
export const studentMessage: Tool<z.infer<typeof studentMessageInput>, unknown> = {
  name: "student.message",
  description: "Send a WhatsApp message to a student (class reminder, support answer, payment reminder).",
  risk: "external",
  input: studentMessageInput,
  describe: (i) => `Message student (${i.purpose}): "${i.text.length > 80 ? `${i.text.slice(0, 80)}…` : i.text}"`,
  supersedeKey: (i) => ({ field: "studentId", value: i.studentId }),
  async run() {
    throw new Error("student.message executes only through the Approval Center");
  },
};

const certificateInput = z.object({ enrollmentId: z.string().uuid() });
export const certificateRequest: Tool<z.infer<typeof certificateInput>, unknown> = {
  name: "certificate.request",
  description: "Request that a certificate be issued for an eligible enrollment. Only request when student.get shows every certificate check passing.",
  risk: "external",
  input: certificateInput,
  describe: () => "Issue course certificate",
  async run() {
    throw new Error("certificate.request executes only through the Approval Center");
  },
};

export const EDUCATION_TOOLS = [catalogTool, studentSearch, studentGet, studentMessage, certificateRequest];
