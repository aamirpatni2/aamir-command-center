/**
 * Lead scoring rules — STARTER SET v1, pending Aamir's approval.
 * Documented in skills/sales/SCORING.md. Scoring is deterministic: the same inputs always
 * give the same score, and every point has a stated reason. Change rules here + in the doc.
 */

export const SCORING_VERSION = "v1-starter";

export interface LeadSignals {
  askedFee?: boolean;
  askedSchedule?: boolean;
  askedEnrollment?: boolean;
  /** Set by a human or the Sales Agent: student, freelancer, teacher, job-seeker, business owner. */
  profileFit?: boolean;
  optedOut?: boolean;
}

export interface ScoreInput {
  signals: LeadSignals;
  source: string;
  inboundMessageCount: number;
  lastInboundAt: Date | null;
  now?: Date;
}

export interface ScoreResult {
  score: number;
  band: "hot" | "warm" | "cold";
  reasons: { rule: string; points: number }[];
}

export const SCORING_RULES = [
  { id: "asked_enrollment", points: 25, label: "Asked how to enrol / pay" },
  { id: "asked_fee", points: 20, label: "Asked about the fee" },
  { id: "asked_schedule", points: 15, label: "Asked about dates or timings" },
  { id: "source_referral", points: 15, label: "Came through a referral" },
  { id: "source_ad", points: 10, label: "Came from a paid ad" },
  { id: "profile_fit", points: 10, label: "Fits the target profile" },
  { id: "engaged", points: 10, label: "Sent 3 or more messages" },
  { id: "inactive_7d", points: -15, label: "No message for 7+ days" },
  { id: "opted_out", points: -60, label: "Said not interested / stop" },
] as const;

export const BANDS = { hot: 60, warm: 30 } as const;

const AD_SOURCES = new Set(["facebook_ad", "instagram_ad", "meta_ad", "google_ad", "tiktok_ad"]);

export function scoreLead(input: ScoreInput): ScoreResult {
  const now = input.now ?? new Date();
  const s = input.signals;
  const hit: Record<string, boolean> = {
    asked_enrollment: !!s.askedEnrollment,
    asked_fee: !!s.askedFee,
    asked_schedule: !!s.askedSchedule,
    source_referral: input.source === "referral",
    source_ad: AD_SOURCES.has(input.source),
    profile_fit: !!s.profileFit,
    engaged: input.inboundMessageCount >= 3,
    inactive_7d: !!input.lastInboundAt && now.getTime() - input.lastInboundAt.getTime() > 7 * 24 * 3600_000,
    opted_out: !!s.optedOut,
  };
  const reasons = SCORING_RULES.filter((r) => hit[r.id]).map((r) => ({ rule: r.label, points: r.points }));
  const score = Math.max(0, Math.min(100, reasons.reduce((a, r) => a + r.points, 0)));
  return { score, band: score >= BANDS.hot ? "hot" : score >= BANDS.warm ? "warm" : "cold", reasons };
}

/**
 * Detects signals in an inbound message (English, Roman Urdu, Urdu script). Deliberately simple and
 * conservative: it only ever ADDS signals; the Sales Agent or a human can refine them.
 */
const PATTERNS: [keyof LeadSignals, RegExp][] = [
  ["askedEnrollment", /\b(enrol+|enrol+ment|admission|register|registration|join|signup|sign up|account (no|number)|jazz ?cash|easy ?paisa|payment|pay kar|seat book)\b|داخلہ|رجسٹر|ادائیگی/i],
  ["askedFee", /\b(fee|fees|price|pricing|cost|charges|kitni|kitne|qeemat|paise)\b|فیس|قیمت|کتنی/i],
  ["askedSchedule", /\b(kab|when|start|starting|timing|timings|schedule|date|class time|din|batch)\b|کب|شروع|وقت/i],
  ["optedOut", /\b(not interested|no thanks|nahi chahiye|nahin chahiye|stop|unsubscribe|mat bhejo|don'?t message)\b|دلچسپی نہیں/i],
];

export function detectSignals(text: string): LeadSignals {
  const found: LeadSignals = {};
  for (const [key, re] of PATTERNS) if (re.test(text)) found[key] = true;
  return found;
}

export function scoreBand(score: number): "hot" | "warm" | "cold" {
  return score >= BANDS.hot ? "hot" : score >= BANDS.warm ? "warm" : "cold";
}
