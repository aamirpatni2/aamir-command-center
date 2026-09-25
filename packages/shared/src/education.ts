/**
 * Education rules — STARTER SET v1, pending Aamir's approval. Documented in skills/student/POLICIES.md.
 */

export const CERTIFICATE_RULES_VERSION = "v1-starter";

export const CERTIFICATE_RULES = {
  /** Share of held classes attended (present or late). */
  minAttendancePct: 75,
  /** Share of batch assignments submitted (ignored if the batch has no assignments). */
  minSubmissionPct: 80,
  /** Verified payments must cover the enrollment price (if a price is set). */
  requireFullPayment: true,
} as const;

export interface ProgressInput {
  enrollmentStatus: "pending" | "active" | "completed" | "dropped" | "refunded";
  classesHeld: number;
  classesAttended: number;
  assignmentsTotal: number;
  assignmentsSubmitted: number;
  priceMinor: number | null;
  paidVerifiedMinor: number;
}

export interface CertificateCheck {
  eligible: boolean;
  checks: { rule: string; ok: boolean; detail: string }[];
}

export const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

export function checkCertificate(p: ProgressInput): CertificateCheck {
  const attendance = pct(p.classesAttended, p.classesHeld);
  const submissions = pct(p.assignmentsSubmitted, p.assignmentsTotal);
  const checks = [
    {
      rule: "Enrollment active or completed",
      ok: p.enrollmentStatus === "active" || p.enrollmentStatus === "completed",
      detail: `status: ${p.enrollmentStatus}`,
    },
    {
      rule: `Attendance ≥ ${CERTIFICATE_RULES.minAttendancePct}%`,
      ok: p.classesHeld > 0 && attendance >= CERTIFICATE_RULES.minAttendancePct,
      detail: p.classesHeld ? `${p.classesAttended}/${p.classesHeld} classes (${attendance}%)` : "no classes held yet",
    },
    {
      rule: `Assignments submitted ≥ ${CERTIFICATE_RULES.minSubmissionPct}%`,
      ok: p.assignmentsTotal === 0 || submissions >= CERTIFICATE_RULES.minSubmissionPct,
      detail: p.assignmentsTotal ? `${p.assignmentsSubmitted}/${p.assignmentsTotal} (${submissions}%)` : "no assignments in this batch",
    },
    {
      rule: "Fee fully paid (verified)",
      ok: !CERTIFICATE_RULES.requireFullPayment || p.priceMinor === null || p.paidVerifiedMinor >= p.priceMinor,
      detail: p.priceMinor === null ? "no price set" : `${p.paidVerifiedMinor / 100} of ${p.priceMinor / 100} verified`,
    },
  ];
  return { eligible: checks.every((c) => c.ok), checks };
}

/** Price for someone enrolling on `onDate` (Asia/Karachi date string YYYY-MM-DD): early-bird if still open. */
export function effectivePriceMinor(
  batch: { priceMinor: number | null; earlyBirdPriceMinor: number | null; earlyBirdUntil: string | null },
  coursePriceMinor: number | null,
  onDate: string,
): { priceMinor: number | null; earlyBird: boolean } {
  const base = batch.priceMinor ?? coursePriceMinor;
  if (batch.earlyBirdPriceMinor != null && batch.earlyBirdUntil && onDate <= batch.earlyBirdUntil) {
    return { priceMinor: batch.earlyBirdPriceMinor, earlyBird: true };
  }
  return { priceMinor: base, earlyBird: false };
}

export const todayInKarachi = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
