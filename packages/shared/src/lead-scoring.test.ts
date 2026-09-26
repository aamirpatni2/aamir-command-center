import { describe, expect, it } from "vitest";
import { detectSignals, scoreLead } from "./lead-scoring.js";
import { normalizePhone } from "./phone.js";

describe("normalizePhone", () => {
  it.each([
    ["0300 1234567", "+923001234567"],
    ["03001234567", "+923001234567"],
    ["923001234567", "+923001234567"],
    ["+92 300-1234567", "+923001234567"],
    ["0092 300 1234567", "+923001234567"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s → %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(["", "12345", "0300 12345", "abc", "+92 300 12345678"])("rejects %s", (input) => expect(normalizePhone(input)).toBeNull());
});

describe("detectSignals", () => {
  it("understands Roman Urdu, English and Urdu", () => {
    expect(detectSignals("Salam, course ki fee kitni hai?")).toMatchObject({ askedFee: true });
    expect(detectSignals("Next batch kab start hoga?")).toMatchObject({ askedSchedule: true });
    expect(detectSignals("How do I enroll? JazzCash chalega?")).toMatchObject({ askedEnrollment: true });
    expect(detectSignals("کورس کی فیس کتنی ہے؟")).toMatchObject({ askedFee: true });
    expect(detectSignals("nahi chahiye shukriya")).toMatchObject({ optedOut: true });
    expect(detectSignals("Assalam o alaikum")).toEqual({});
  });
});

describe("scoreLead", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  it("hot lead: enrol + fee + schedule + ad", () => {
    const r = scoreLead({ signals: { askedEnrollment: true, askedFee: true, askedSchedule: true }, source: "facebook_ad", inboundMessageCount: 1, lastInboundAt: now, now });
    expect(r.score).toBe(70);
    expect(r.band).toBe("hot");
    expect(r.reasons.map((x) => x.points)).toEqual([25, 20, 15, 10]);
  });
  it("is clamped and explains negatives", () => {
    const r = scoreLead({ signals: { optedOut: true }, source: "whatsapp", inboundMessageCount: 1, lastInboundAt: new Date("2026-09-01"), now });
    expect(r.score).toBe(0);
    expect(r.band).toBe("cold");
    expect(r.reasons.map((x) => x.rule)).toEqual(["No message for 7+ days", "Said not interested / stop"]);
  });
  it("warm band", () => {
    expect(scoreLead({ signals: { askedFee: true, askedSchedule: true }, source: "whatsapp", inboundMessageCount: 1, lastInboundAt: now, now }).band).toBe("warm");
  });
});
