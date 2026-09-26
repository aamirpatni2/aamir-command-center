import { z } from "zod";
import { createReport, getAnalytics, getToday, presetRange, previousRange, validateRange, type DateRange, type RangePreset } from "@acc/database";
import type { MetaAdsClient } from "../integrations/meta/ads.js";
import type { Tool } from "./types.js";

const PRESETS = ["today", "yesterday", "last_7_days", "last_30_days", "last_90_days", "last_week", "this_month", "last_month"] as const;
const rangeFields = {
  preset: z.enum(PRESETS).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
};
const oneRange = (i: { preset?: string; from?: string; to?: string }) => !!i.preset !== !!(i.from && i.to);
const rangeInput = z.object(rangeFields).refine(oneRange, "Give either a preset or both from and to");
const saveInput = z
  .object({ ...rangeFields, period: z.enum(["daily", "weekly", "monthly", "custom"]), narrative: z.string().min(20).max(8000) })
  .refine(oneRange, "Give either a preset or both from and to");

const toRange = (i: { preset?: string; from?: string; to?: string }): DateRange => validateRange(i.preset ? presetRange(i.preset as RangePreset) : { from: i.from!, to: i.to! });

/** Day-by-day arrays are dropped for the model (totals are what it reasons about). */
function compact(a: Awaited<ReturnType<typeof getAnalytics>>) {
  return { ...a, revenue: { ...a.revenue, byDay: undefined }, leads: { ...a.leads, byDay: undefined } };
}

export function makeAnalyticsTools(ads: MetaAdsClient | null): Tool<any, any>[] {
  const report: Tool<z.infer<typeof rangeInput>, unknown> = {
    name: "analytics.report",
    description: "All business metrics (revenue, leads, funnel, WhatsApp reply speed, students, content, agents, approvals, automations) for a period in Pakistan time, plus the previous period of the same length.",
    risk: "read",
    input: rangeInput,
    async run(i, { db }) {
      const range = toRange(i);
      const [current, previous] = await Promise.all([getAnalytics(db, range), getAnalytics(db, previousRange(range))]);
      return { current: compact(current), previous: compact(previous) };
    },
  };
  const today: Tool<Record<string, never>, unknown> = {
    name: "analytics.today",
    description: "What needs Aamir personally today: unanswered WhatsApp chats, hot leads gone quiet, follow-ups due, payments to verify, approvals, today's classes.",
    risk: "read",
    input: z.object({}).strict(),
    run: async (_i, { db }) => getToday(db),
  };
  const save: Tool<z.infer<typeof saveInput>, unknown> = {
    name: "analytics.save_report",
    description: "Save a report for a period with your written narrative. The server recomputes every number for the period itself; only the narrative comes from you.",
    risk: "draft",
    input: saveInput,
    async run(i, { db, taskId }) {
      const row = await createReport(db, { period: i.period, range: toRange(i), narrative: i.narrative, source: "agent", taskId });
      return { saved: true, reportId: row.id, title: row.title };
    },
  };
  const adsInsights: Tool<{ preset: "last_7d" | "last_30d" | "last_90d" }, unknown> = {
    name: "ads.insights",
    description: "Read-only Meta (Facebook/Instagram) ad campaign results: spend, impressions, clicks, leads, cost per lead. Never changes campaigns.",
    risk: "read",
    input: z.object({ preset: z.enum(["last_7d", "last_30d", "last_90d"]).default("last_7d") }),
    run: async (i) => (ads ? ads.campaignInsights(i.preset) : { status: "not_configured", missing: ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"] }),
  };
  return [report, today, save, adsInsights];
}
