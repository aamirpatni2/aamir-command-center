import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MetaAdsClient, TaskQueue } from "@acc/agents";
import {
  createReport, desc, eq, getAnalytics, getInsights, getToday, presetRange, previousRange, schema, validateRange, writeAudit, type Database, type DateRange, type RangePreset,
} from "@acc/database";
import { HttpError, notFound, parse } from "../lib/errors.js";
import { auditMeta } from "../lib/audit.js";
import { requireAuth } from "../plugins/auth.js";

const PRESETS = ["today", "yesterday", "last_7_days", "last_30_days", "last_90_days", "last_week", "this_month", "last_month"] as const;
const rangeQuery = z.object({
  preset: z.enum(PRESETS).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function toRange(q: z.infer<typeof rangeQuery>, fallback: RangePreset = "last_30_days"): DateRange {
  try {
    if (q.from && q.to) return validateRange({ from: q.from, to: q.to });
    return presetRange((q.preset ?? fallback) as RangePreset);
  } catch (e) {
    throw new HttpError(400, "VALIDATION_ERROR", (e as Error).message);
  }
}

export async function analyticsRoutes(app: FastifyInstance, opts: { db: Database; ads: MetaAdsClient; queue: TaskQueue }) {
  const { db, ads, queue } = opts;

  app.get("/api/analytics", { preHandler: requireAuth("analytics:read") }, async (req) => {
    const range = toRange(parse(rangeQuery, req.query));
    const [current, previous] = await Promise.all([getAnalytics(db, range), getAnalytics(db, previousRange(range))]);
    return { current, previous };
  });

  app.get("/api/analytics/today", { preHandler: requireAuth("analytics:read") }, async () => getToday(db));

  app.get("/api/analytics/insights", { preHandler: requireAuth("analytics:read") }, async (req) => {
    const { insights, current } = await getInsights(db, toRange(parse(rangeQuery, req.query)));
    return { insights, range: current.range };
  });

  app.get("/api/ads", { preHandler: requireAuth("campaigns:read") }, async (req) => {
    const q = parse(z.object({ preset: z.enum(["last_7d", "last_30d", "last_90d"]).default("last_7d") }), req.query);
    return ads.campaignInsights(q.preset);
  });

  // ── Reports ──
  app.get("/api/reports", { preHandler: requireAuth("analytics:read") }, async () => {
    const rows = await db
      .select({
        id: schema.analyticsReports.id, title: schema.analyticsReports.title, period: schema.analyticsReports.period, fromDate: schema.analyticsReports.fromDate,
        toDate: schema.analyticsReports.toDate, source: schema.analyticsReports.source, hasNarrative: schema.analyticsReports.narrative, createdAt: schema.analyticsReports.createdAt, taskId: schema.analyticsReports.taskId,
      })
      .from(schema.analyticsReports)
      .orderBy(desc(schema.analyticsReports.createdAt))
      .limit(100);
    return { reports: rows.map((r) => ({ ...r, hasNarrative: !!r.hasNarrative })) };
  });

  app.get("/api/reports/:id", { preHandler: requireAuth("analytics:read") }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const [report] = await db.select().from(schema.analyticsReports).where(eq(schema.analyticsReports.id, id));
    if (!report) throw notFound("Report");
    return { report };
  });

  /** A numbers-only snapshot, straight from the database (no AI involved). */
  app.post("/api/reports", { preHandler: requireAuth("tasks:create") }, async (req, reply) => {
    const body = parse(rangeQuery.extend({ period: z.enum(["daily", "weekly", "monthly", "custom"]) }), req.body);
    const report = await createReport(db, { period: body.period, range: toRange(body, "yesterday"), source: "user", createdBy: req.auth!.user.id });
    await writeAudit(db, { ...auditMeta(req), action: "report.create", entityType: "analytics_report", entityId: report.id });
    return reply.code(201).send({ report });
  });

  /** Asks the Analytics Agent to write the narrative; it saves the report through analytics.save_report. */
  app.post("/api/reports/agent", { preHandler: [requireAuth("tasks:create"), app.agentRuns.guard] }, async (req, reply) => {
    const body = parse(z.object({ preset: z.enum(PRESETS), period: z.enum(["daily", "weekly", "monthly", "custom"]) }), req.body);
    const range = toRange({ preset: body.preset });
    const instruction = `Write the ${body.period} report for ${range.from} to ${range.to} (preset ${body.preset}): call analytics.report with preset ${body.preset}, compare with the previous period, and save it with analytics.save_report (period ${body.period}, preset ${body.preset}). Lead with what changed and the 3 most useful next actions.`;
    const [task] = await db
      .insert(schema.agentTasks)
      .values({
        title: `Analytics · ${body.period} report`,
        input: instruction,
        requestedBy: req.auth!.user.id,
        plan: { preset: true, skipReview: true, intent: "Write an analytics report", language: "en", steps: [{ agent: "analytics", instruction, acceptance: "Report saved with analytics.save_report.", dependsOn: [] }] },
      })
      .returning();
    await writeAudit(db, { ...auditMeta(req), action: "task.create", entityType: "agent_task", entityId: task!.id, metadata: { kind: "analytics_report" } });
    try {
      await queue.enqueue(task!.id);
    } catch {
      await db.update(schema.agentTasks).set({ status: "FAILED", error: "Task queue unavailable (is Redis running?)" }).where(eq(schema.agentTasks.id, task!.id));
      throw new HttpError(503, "QUEUE_UNAVAILABLE", "The task queue is unavailable. Is Redis running?");
    }
    return reply.code(202).send({ task });
  });
}
