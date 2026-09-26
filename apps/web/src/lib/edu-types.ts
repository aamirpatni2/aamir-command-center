export interface CertificateCheck { rule: string; ok: boolean; detail: string }
export interface Progress {
  enrollmentId: string;
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
  certificate: { eligible: boolean; checks: CertificateCheck[] };
}
export interface Batch {
  id: string;
  courseId: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  schedule: { day: string; time: string; tz: string }[] | null;
  capacity: number | null;
  status: string;
  priceMinor: number | null;
  earlyBirdPriceMinor: number | null;
  earlyBirdUntil: string | null;
  enrolled: number;
  seatsLeft: number | null;
  currentPriceMinor: number | null;
  earlyBirdActive: boolean;
}
export interface Course {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  level: string | null;
  language: string;
  priceMinor: number | null;
  durationWeeks: number | null;
  status: "draft" | "active" | "archived";
  batches: Batch[];
}
export interface ClassRow {
  id: string;
  batchId: string;
  title: string;
  startsAt: string;
  durationMin: number;
  meetingUrl: string | null;
  recordingUrl: string | null;
  recordingStatus: "none" | "processing" | "available";
  attendance: Record<string, "present" | "absent" | "late">;
  batchName?: string;
  courseTitle?: string;
  attendanceSummary?: { present: number; late: number; absent: number };
}
export interface Payment {
  id: string;
  amountMinor: number;
  method: string;
  status: "pending" | "verified" | "refunded" | "failed";
  reference: string | null;
  paidAt: string | null;
}
