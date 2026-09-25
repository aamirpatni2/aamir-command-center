/**
 * Education domain logic: enrollment progress, payment totals, certificate eligibility.
 * Shared by the API and the Student Agent's tools.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { checkCertificate, effectivePriceMinor, todayInKarachi, type CertificateCheck } from "@acc/shared";
import type { DbOrTx } from "./crm.js";
import { assignmentSubmissions, assignments, classes, courseBatches, courses, enrollments, payments } from "./schema/index.js";

export interface EnrollmentProgress {
  enrollmentId: string;
  batchId: string;
  status: "pending" | "active" | "completed" | "dropped" | "refunded";
  certificateStatus: "not_eligible" | "eligible" | "issued";
  classesHeld: number;
  classesAttended: number;
  attendancePct: number;
  assignmentsTotal: number;
  assignmentsSubmitted: number;
  priceMinor: number | null;
  paidVerifiedMinor: number;
  paidPendingMinor: number;
  balanceMinor: number | null;
  certificate: CertificateCheck;
}

export async function enrollmentProgress(db: DbOrTx, enrollmentIds: string[]): Promise<Map<string, EnrollmentProgress>> {
  const out = new Map<string, EnrollmentProgress>();
  if (!enrollmentIds.length) return out;

  const rows = await db
    .select({ e: enrollments, b: courseBatches, coursePrice: courses.priceMinor })
    .from(enrollments)
    .innerJoin(courseBatches, eq(courseBatches.id, enrollments.batchId))
    .innerJoin(courses, eq(courses.id, courseBatches.courseId))
    .where(inArray(enrollments.id, enrollmentIds));
  const batchIds = [...new Set(rows.map((r) => r.b.id))];

  const held = await db
    .select({ batchId: classes.batchId, attendance: classes.attendance })
    .from(classes)
    .where(and(inArray(classes.batchId, batchIds), sql`${classes.startsAt} <= now()`));
  const assignmentCounts = await db
    .select({ batchId: assignments.batchId, n: sql<number>`count(*)::int` })
    .from(assignments)
    .where(inArray(assignments.batchId, batchIds))
    .groupBy(assignments.batchId);
  const submitted = await db
    .select({ enrollmentId: assignmentSubmissions.enrollmentId, n: sql<number>`count(*)::int` })
    .from(assignmentSubmissions)
    .where(and(inArray(assignmentSubmissions.enrollmentId, enrollmentIds), inArray(assignmentSubmissions.status, ["submitted", "late", "graded"])))
    .groupBy(assignmentSubmissions.enrollmentId);
  const paid = await db
    .select({
      enrollmentId: payments.enrollmentId,
      verified: sql<number>`coalesce(sum(${payments.amountMinor}) filter (where ${payments.status} = 'verified'), 0)::bigint`,
      pending: sql<number>`coalesce(sum(${payments.amountMinor}) filter (where ${payments.status} = 'pending'), 0)::bigint`,
    })
    .from(payments)
    .where(inArray(payments.enrollmentId, enrollmentIds))
    .groupBy(payments.enrollmentId);

  for (const { e, b, coursePrice } of rows) {
    const batchClasses = held.filter((c) => c.batchId === b.id);
    const attended = batchClasses.filter((c) => ["present", "late"].includes(c.attendance[e.id] ?? "")).length;
    const assignmentsTotal = assignmentCounts.find((a) => a.batchId === b.id)?.n ?? 0;
    const assignmentsSubmitted = submitted.find((s) => s.enrollmentId === e.id)?.n ?? 0;
    const p = paid.find((x) => x.enrollmentId === e.id);
    // Price is fixed at the enrollment date (early-bird honoured if they enrolled in time).
    const priceDate = todayInKarachi(e.enrolledAt ?? e.createdAt);
    const { priceMinor } = effectivePriceMinor(
      { priceMinor: b.priceMinor, earlyBirdPriceMinor: b.earlyBirdPriceMinor, earlyBirdUntil: b.earlyBirdUntil },
      coursePrice,
      priceDate,
    );
    const paidVerifiedMinor = Number(p?.verified ?? 0);
    const input = {
      enrollmentStatus: e.status,
      classesHeld: batchClasses.length,
      classesAttended: attended,
      assignmentsTotal,
      assignmentsSubmitted,
      priceMinor,
      paidVerifiedMinor,
    };
    out.set(e.id, {
      enrollmentId: e.id,
      batchId: b.id,
      status: e.status,
      certificateStatus: e.certificateStatus,
      classesHeld: input.classesHeld,
      classesAttended: attended,
      attendancePct: input.classesHeld ? Math.round((attended / input.classesHeld) * 100) : 0,
      assignmentsTotal,
      assignmentsSubmitted,
      priceMinor,
      paidVerifiedMinor,
      paidPendingMinor: Number(p?.pending ?? 0),
      balanceMinor: priceMinor === null ? null : Math.max(0, priceMinor - paidVerifiedMinor),
      certificate: checkCertificate(input),
    });
  }
  return out;
}

/** Active catalogue for agents and the enrol form: active courses with their open batches and today's price. */
export async function courseCatalog(db: DbOrTx, opts: { includeDraft?: boolean } = {}) {
  const courseRows = await db
    .select()
    .from(courses)
    .where(and(isNull(courses.deletedAt), opts.includeDraft ? undefined : eq(courses.status, "active")));
  if (!courseRows.length) return [];
  const batches = await db
    .select({
      b: courseBatches,
      enrolled: sql<number>`(select count(*)::int from enrollments e where e.batch_id = ${courseBatches.id} and e.status in ('pending','active','completed'))`,
    })
    .from(courseBatches)
    .where(
      and(
        inArray(courseBatches.courseId, courseRows.map((c) => c.id)),
        isNull(courseBatches.deletedAt),
        opts.includeDraft ? undefined : inArray(courseBatches.status, ["planned", "enrolling", "running"]),
      ),
    );
  const today = todayInKarachi();
  return courseRows.map((c) => ({
    ...c,
    batches: batches
      .filter((x) => x.b.courseId === c.id)
      .map(({ b, enrolled }) => {
        const price = effectivePriceMinor({ priceMinor: b.priceMinor, earlyBirdPriceMinor: b.earlyBirdPriceMinor, earlyBirdUntil: b.earlyBirdUntil }, c.priceMinor, today);
        return {
          ...b,
          enrolled,
          seatsLeft: b.capacity == null ? null : Math.max(0, b.capacity - enrolled),
          currentPriceMinor: price.priceMinor,
          earlyBirdActive: price.earlyBird,
        };
      }),
  }));
}
