import { describe, expect, it } from "vitest";
import { checkCertificate, effectivePriceMinor, todayInKarachi } from "./education.js";

const base = { enrollmentStatus: "active" as const, classesHeld: 8, classesAttended: 6, assignmentsTotal: 5, assignmentsSubmitted: 4, priceMinor: 800_000, paidVerifiedMinor: 800_000 };

describe("certificate eligibility", () => {
  it("eligible at exactly the thresholds", () => {
    expect(checkCertificate(base).eligible).toBe(true);
  });
  it("lists every failing rule", () => {
    const r = checkCertificate({ ...base, classesAttended: 5, assignmentsSubmitted: 3, paidVerifiedMinor: 500_000, enrollmentStatus: "pending" });
    expect(r.eligible).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.rule)).toEqual([
      "Enrollment active or completed", "Attendance ≥ 75%", "Assignments submitted ≥ 80%", "Fee fully paid (verified)",
    ]);
  });
  it("no classes held yet is never eligible; no assignments is fine", () => {
    expect(checkCertificate({ ...base, classesHeld: 0, classesAttended: 0 }).eligible).toBe(false);
    expect(checkCertificate({ ...base, assignmentsTotal: 0, assignmentsSubmitted: 0 }).eligible).toBe(true);
  });
});

describe("pricing", () => {
  const batch = { priceMinor: 800_000, earlyBirdPriceMinor: 500_000, earlyBirdUntil: "2026-08-05" };
  it("early-bird until and including the deadline", () => {
    expect(effectivePriceMinor(batch, null, "2026-08-05")).toEqual({ priceMinor: 500_000, earlyBird: true });
    expect(effectivePriceMinor(batch, null, "2026-08-06")).toEqual({ priceMinor: 800_000, earlyBird: false });
  });
  it("falls back to the course price", () => {
    expect(effectivePriceMinor({ priceMinor: null, earlyBirdPriceMinor: null, earlyBirdUntil: null }, 700_000, "2026-01-01").priceMinor).toBe(700_000);
  });
  it("uses the Karachi calendar date", () => {
    expect(todayInKarachi(new Date("2026-08-05T20:00:00Z"))).toBe("2026-08-06"); // 01:00 PKT next day
  });
});
