import { sql } from "drizzle-orm";
import { bigint, char, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common.js";
import {
  batchStatus,
  certificateStatus,
  contentLanguage,
  courseStatus,
  enrollmentStatus,
  paymentMethod,
  paymentStatus,
  recordingStatus,
  studentStatus,
  submissionStatus,
} from "./enums.js";
import { users } from "./identity.js";
import { contacts, leads } from "./crm.js";

export const courses = pgTable(
  "courses",
  {
    id: id(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    level: text("level"),
    language: contentLanguage("language").notNull().default("ur"),
    priceMinor: bigint("price_minor", { mode: "number" }),
    currency: char("currency", { length: 3 }).notNull().default("PKR"),
    durationWeeks: integer("duration_weeks"),
    status: courseStatus("status").notNull().default("draft"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex("courses_slug_unique").on(t.slug).where(sql`${t.deletedAt} IS NULL`)],
);

export const courseBatches = pgTable(
  "course_batches",
  {
    id: id(),
    courseId: uuid("course_id").notNull().references(() => courses.id),
    name: text("name").notNull(),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    schedule: jsonb("schedule").$type<{ day: string; time: string; tz: string }[]>(),
    capacity: integer("capacity"),
    status: batchStatus("status").notNull().default("planned"),
    priceMinor: bigint("price_minor", { mode: "number" }),
    earlyBirdPriceMinor: bigint("early_bird_price_minor", { mode: "number" }),
    earlyBirdUntil: date("early_bird_until"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("course_batches_course_idx").on(t.courseId), index("course_batches_status_idx").on(t.status)],
);

export const students = pgTable(
  "students",
  {
    id: id(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id),
    userId: uuid("user_id").references(() => users.id),
    status: studentStatus("status").notNull().default("active"),
    notes: text("notes"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex("students_contact_unique").on(t.contactId).where(sql`${t.deletedAt} IS NULL`)],
);

export const enrollments = pgTable(
  "enrollments",
  {
    id: id(),
    studentId: uuid("student_id").notNull().references(() => students.id),
    batchId: uuid("batch_id").notNull().references(() => courseBatches.id),
    status: enrollmentStatus("status").notNull().default("pending"),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
    certificateStatus: certificateStatus("certificate_status").notNull().default("not_eligible"),
    certificateUrl: text("certificate_url"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("enrollments_student_batch_unique").on(t.studentId, t.batchId),
    index("enrollments_batch_idx").on(t.batchId),
  ],
);

export const classes = pgTable(
  "classes",
  {
    id: id(),
    batchId: uuid("batch_id").notNull().references(() => courseBatches.id),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull().default(90),
    meetingUrl: text("meeting_url"),
    recordingUrl: text("recording_url"),
    recordingStatus: recordingStatus("recording_status").notNull().default("none"),
    /** { [enrollmentId]: "present" | "absent" | "late" } */
    attendance: jsonb("attendance").$type<Record<string, "present" | "absent" | "late">>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("classes_batch_idx").on(t.batchId, t.startsAt)],
);

export const assignments = pgTable(
  "assignments",
  {
    id: id(),
    batchId: uuid("batch_id").notNull().references(() => courseBatches.id),
    classId: uuid("class_id").references(() => classes.id),
    title: text("title").notNull(),
    instructions: text("instructions"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    maxScore: integer("max_score"),
    ...timestamps,
  },
  (t) => [index("assignments_batch_idx").on(t.batchId)],
);

export const assignmentSubmissions = pgTable(
  "assignment_submissions",
  {
    id: id(),
    assignmentId: uuid("assignment_id").notNull().references(() => assignments.id),
    enrollmentId: uuid("enrollment_id").notNull().references(() => enrollments.id),
    status: submissionStatus("status").notNull().default("pending"),
    submissionUrl: text("submission_url"),
    score: integer("score"),
    feedback: text("feedback"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("submissions_assignment_enrollment_unique").on(t.assignmentId, t.enrollmentId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    enrollmentId: uuid("enrollment_id").references(() => enrollments.id),
    leadId: uuid("lead_id").references(() => leads.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PKR"),
    method: paymentMethod("method").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    reference: text("reference"),
    verifiedBy: uuid("verified_by").references(() => users.id),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payments_method_reference_unique").on(t.method, t.reference).where(sql`${t.reference} IS NOT NULL`),
    index("payments_enrollment_idx").on(t.enrollmentId),
    index("payments_status_idx").on(t.status, t.paidAt),
  ],
);
