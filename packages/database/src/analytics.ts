/**
 * Analytics: read-only aggregates over real records. Every figure here is computed from the
 * database for a date range of Pakistan calendar days (Asia/Karachi), inclusive of both ends.
 * Nothing is estimated or filled in: missing data shows as 0 or null.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "./crm.js";
import { analyticsReports } from "./schema/index.js";

export const ANALYTICS_TZ = "Asia/Karachi";

export interface DateRange {
  /** YYYY-MM-DD, Pakistan calendar day, inclusive */
  from: string;
  /** YYYY-MM-DD, inclusive */
  to: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function karachiDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ANALYTICS_TZ }).format(d);
}

export function shiftDate(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(r: DateRange) {
  return Math.round((new Date(`${r.to}T00:00:00Z`).getTime() - new Date(`${r.from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
}

export type RangePreset = "today" | "yesterday" | "last_7_days" | "last_30_days" | "last_90_days" | "last_week" | "this_month" | "last_month";

/** Named ranges agents and the UI can ask for (weeks start on Monday). */
export function presetRange(preset: RangePreset, now = new Date()): DateRange {
  const today = karachiDate(now);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  switch (preset) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: shiftDate(today, -1), to: shiftDate(today, -1) };
    case "last_7_days": return { from: shiftDate(today, -6), to: today };
    case "last_30_days": return { from: shiftDate(today, -29), to: today };
    case "last_90_days": return { from: shiftDate(today, -89), to: today };
    case "last_week": return { from: shiftDate(today, -dow - 7), to: shiftDate(today, -dow - 1) };
    case "this_month": return { from: `${today.slice(0, 8)}01`, to: today };
    case "last_month": {
      const first = new Date(`${today.slice(0, 8)}01T00:00:00Z`);
      first.setUTCMonth(first.getUTCMonth() - 1);
      const from = first.toISOString().slice(0, 10);
      return { from, to: shiftDate(`${today.slice(0, 8)}01`, -1) };
    }
  }
}

export function validateRange(r: DateRange): DateRange {
  if (!DAY.test(r.from) || !DAY.test(r.to)) throw new Error("Dates must be YYYY-MM-DD");
  if (r.from > r.to) throw new Error("`from` must not be after `to`");
  if (daysBetween(r) > 366) throw new Error("Ranges are limited to one year");
  return r;
}

/** The same-length range just before this one (for comparisons). */
export function previousRange(r: DateRange): DateRange {
  const n = daysBetween(r);
  return { from: shiftDate(r.from, -n), to: shiftDate(r.from, -1) };
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

export async function getAnalytics(db: DbOrTx, range: DateRange) {
  const r = validateRange(range);
  const tz = ANALYTICS_TZ;
  const start = sql`((${r.from}::date)::timestamp at time zone ${tz})`;
  const end = sql`((${r.to}::date + 1)::timestamp at time zone ${tz})`;
  const inRange = (col: string) => sql`${sql.raw(col)} >= ${start} and ${sql.raw(col)} < ${end}`;
  const dayOf = (col: string) => sql`to_char((${sql.raw(col)} at time zone ${tz})::date, 'YYYY-MM-DD')`;

  // ── Revenue (verified payments only count) ──
  const [rev] = await db.execute<{ verified: string; pending: string; payments: string; refunded: string }>(sql`
    select coalesce(sum(amount_minor) filter (where status = 'verified'), 0) as verified,
           coalesce(sum(amount_minor) filter (where status = 'pending'), 0) as pending,
           coalesce(sum(amount_minor) filter (where status = 'refunded'), 0) as refunded,
           count(*) filter (where status = 'verified') as payments
    from payments where currency = 'PKR' and ${inRange("coalesce(paid_at, created_at)")}
  `);
  const revenueByDay = await db.execute<{ day: string; minor: string }>(sql`
    with days as (select generate_series(${r.from}::date, ${r.to}::date, interval '1 day')::date as d)
    select to_char(days.d, 'YYYY-MM-DD') as day, coalesce(sum(p.amount_minor), 0) as minor
    from days left join payments p on p.status = 'verified' and p.currency = 'PKR'
      and ((coalesce(p.paid_at, p.created_at) at time zone ${tz})::date) = days.d
    group by days.d order by days.d
  `);
  const revenueByCourse = await db.execute<{ course: string; minor: string; payments: string }>(sql`
    select coalesce(c.title, 'Not linked to a course') as course, sum(p.amount_minor) as minor, count(*) as payments
    from payments p
    left join enrollments e on e.id = p.enrollment_id
    left join course_batches b on b.id = e.batch_id
    left join courses c on c.id = b.course_id
    where p.status = 'verified' and p.currency = 'PKR' and ${inRange("coalesce(p.paid_at, p.created_at)")}
    group by 1 order by 2 desc
  `);

  // ── Leads (created in range, by their current status) ──
  const [leadTotals] = await db.execute<Record<string, string>>(sql`
    select count(*) as total,
      count(*) filter (where status <> 'new') as contacted,
      count(*) filter (where status in ('qualified', 'interested', 'negotiating', 'won')) as qualified,
      count(*) filter (where status = 'won') as won,
      count(*) filter (where status = 'lost') as lost,
      count(*) filter (where score >= 60 and status not in ('won', 'lost')) as hot_open
    from leads where deleted_at is null and ${inRange("created_at")}
  `);
  const leadsBySource = await db.execute<{ source: string; leads: string; won: string }>(sql`
    select source, count(*) as leads, count(*) filter (where status = 'won') as won
    from leads where deleted_at is null and ${inRange("created_at")}
    group by source order by count(*) desc, source
  `);
  const leadsByDay = await db.execute<{ day: string; leads: string }>(sql`
    with days as (select generate_series(${r.from}::date, ${r.to}::date, interval '1 day')::date as d)
    select to_char(days.d, 'YYYY-MM-DD') as day, count(l.id) as leads
    from days left join leads l on l.deleted_at is null and ((l.created_at at time zone ${tz})::date) = days.d
    group by days.d order by days.d
  `);

  // ── WhatsApp: volume and how fast customers get an answer ──
  const [wa] = await db.execute<{ inbound: string; outbound: string; conversations: string; turns: string; replied: string; median_min: string | null; p90_min: string | null }>(sql`
    with m as (
      select id, conversation_id, direction, created_at,
        lag(direction) over (partition by conversation_id order by created_at) as prev_dir
      from messages
    ),
    turns as (
      select m.conversation_id, m.created_at,
        (select min(o.created_at) from messages o where o.conversation_id = m.conversation_id and o.direction = 'outbound' and o.created_at > m.created_at) as replied_at
      from m
      where m.direction = 'inbound' and m.prev_dir is distinct from 'inbound' and m.created_at >= ${start} and m.created_at < ${end}
    )
    select
      (select count(*) from messages where direction = 'inbound' and ${inRange("created_at")}) as inbound,
      (select count(*) from messages where direction = 'outbound' and ${inRange("created_at")}) as outbound,
      (select count(distinct conversation_id) from messages where ${inRange("created_at")}) as conversations,
      (select count(*) from turns) as turns,
      (select count(replied_at) from turns) as replied,
      (select percentile_cont(0.5) within group (order by extract(epoch from replied_at - created_at) / 60) from turns where replied_at is not null) as median_min,
      (select percentile_cont(0.9) within group (order by extract(epoch from replied_at - created_at) / 60) from turns where replied_at is not null) as p90_min
  `);

  // ── Students ──
  const [stu] = await db.execute<{ enrollments: string; active: string; classes: string; marked: string; attended: string }>(sql`
    select
      (select count(*) from enrollments where ${inRange("coalesce(enrolled_at, created_at)")}) as enrollments,
      (select count(*) from students where deleted_at is null and status = 'active') as active,
      (select count(*) from classes where ${inRange("starts_at")} and starts_at <= now()) as classes,
      (select count(*) from classes c, jsonb_each_text(c.attendance) a where ${inRange("c.starts_at")}) as marked,
      (select count(*) from classes c, jsonb_each_text(c.attendance) a where ${inRange("c.starts_at")} and a.value in ('present', 'late')) as attended
  `);

  // ── Content ──
  const contentByType = await db.execute<{ type: string; created: string; published: string }>(sql`
    select type, count(*) filter (where ${inRange("created_at")}) as created,
      count(*) filter (where status = 'published' and ${inRange("published_at")}) as published
    from content_items where deleted_at is null
    group by type having count(*) filter (where ${inRange("created_at")}) > 0 or count(*) filter (where status = 'published' and ${inRange("published_at")}) > 0
    order by 2 desc
  `);

  // ── Agents ──
  const agentRows = await db.execute<{ agent: string; runs: string; completed: string; failed: string; waiting: string; avg_latency: string | null; tokens: string; cost: string; mock: string }>(sql`
    select agent_id as agent, count(*) as runs,
      count(*) filter (where status = 'COMPLETED') as completed,
      count(*) filter (where status = 'FAILED') as failed,
      count(*) filter (where status = 'WAITING_APPROVAL') as waiting,
      avg(latency_ms) filter (where latency_ms is not null) as avg_latency,
      coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0) as tokens,
      coalesce(sum(cost_micro_usd), 0) as cost,
      count(*) filter (where model_provider = 'mock') as mock
    from agent_runs where ${inRange("created_at")}
    group by agent_id order by count(*) desc
  `);

  // ── Approvals ──
  const [appr] = await db.execute<Record<string, string | null>>(sql`
    select count(*) as requested,
      count(*) filter (where status = 'pending') as pending,
      count(*) filter (where status = 'executed') as executed,
      count(*) filter (where status = 'approved') as approved_not_executed,
      count(*) filter (where status = 'rejected') as rejected,
      count(*) filter (where status = 'expired') as expired,
      count(*) filter (where status = 'failed') as failed,
      percentile_cont(0.5) within group (order by extract(epoch from decided_at - created_at) / 60) filter (where decided_at is not null and status not in ('expired')) as median_decision_min
    from approvals where ${inRange("created_at")}
  `);

  // ── Automations ──
  const autoRows = await db.execute<{ rule: string; runs: string; completed: string; failed: string; rate_limited: string }>(sql`
    select r.name as rule, count(a.id) as runs,
      count(a.id) filter (where a.status = 'completed') as completed,
      count(a.id) filter (where a.status in ('failed', 'partial')) as failed,
      count(a.id) filter (where a.status = 'rate_limited') as rate_limited
    from automation_runs a join automation_rules r on r.id = a.rule_id
    where a.created_at >= ${start} and a.created_at < ${end}
    group by r.name order by count(a.id) desc
  `);

  // ── Ads (from synced campaign metrics, if any) ──
  const [ads] = await db.execute<{ spend: string; clicks: string; impressions: string; leads: string }>(sql`
    select coalesce(sum(spend_minor), 0) as spend, coalesce(sum(clicks), 0) as clicks, coalesce(sum(impressions), 0) as impressions, coalesce(sum(leads), 0) as leads
    from campaign_metrics where date between ${r.from}::date and ${r.to}::date
  `);

  const total = n(leadTotals?.total);
  const agentsTotal = agentRows.reduce((t, a) => t + n(a.runs), 0);
  const agentsCompleted = agentRows.reduce((t, a) => t + n(a.completed), 0);
  const agentsFailed = agentRows.reduce((t, a) => t + n(a.failed), 0);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

  return {
    range: { ...r, days: daysBetween(r), timezone: tz },
    revenue: {
      verifiedMinor: n(rev?.verified),
      pendingMinor: n(rev?.pending),
      refundedMinor: n(rev?.refunded),
      payments: n(rev?.payments),
      byDay: revenueByDay.map((d) => ({ day: d.day, minor: n(d.minor) })),
      byCourse: revenueByCourse.map((c) => ({ course: c.course, minor: n(c.minor), payments: n(c.payments) })),
    },
    leads: {
      new: total,
      won: n(leadTotals?.won),
      lost: n(leadTotals?.lost),
      hotOpen: n(leadTotals?.hot_open),
      conversionRate: pct(n(leadTotals?.won), total),
      funnel: [
        { stage: "New leads", count: total },
        { stage: "Contacted", count: n(leadTotals?.contacted) },
        { stage: "Qualified or further", count: n(leadTotals?.qualified) },
        { stage: "Won", count: n(leadTotals?.won) },
      ],
      bySource: leadsBySource.map((s) => ({ source: s.source, leads: n(s.leads), won: n(s.won), conversionRate: pct(n(s.won), n(s.leads)) })),
      byDay: leadsByDay.map((d) => ({ day: d.day, leads: n(d.leads) })),
    },
    whatsapp: {
      inbound: n(wa?.inbound),
      outbound: n(wa?.outbound),
      conversations: n(wa?.conversations),
      customerTurns: n(wa?.turns),
      answered: n(wa?.replied),
      answeredRate: pct(n(wa?.replied), n(wa?.turns)),
      medianReplyMinutes: nOrNull(wa?.median_min),
      p90ReplyMinutes: nOrNull(wa?.p90_min),
    },
    students: {
      newEnrollments: n(stu?.enrollments),
      activeStudents: n(stu?.active),
      classesHeld: n(stu?.classes),
      attendanceRate: pct(n(stu?.attended), n(stu?.marked)),
    },
    content: {
      created: contentByType.reduce((t, c) => t + n(c.created), 0),
      published: contentByType.reduce((t, c) => t + n(c.published), 0),
      byType: contentByType.map((c) => ({ type: c.type, created: n(c.created), published: n(c.published) })),
    },
    agents: {
      runs: agentsTotal,
      completed: agentsCompleted,
      failed: agentsFailed,
      successRate: pct(agentsCompleted, agentsTotal - agentRows.reduce((t, a) => t + n(a.waiting), 0)),
      tokens: agentRows.reduce((t, a) => t + n(a.tokens), 0),
      costMicroUsd: agentRows.reduce((t, a) => t + n(a.cost), 0),
      mockRuns: agentRows.reduce((t, a) => t + n(a.mock), 0),
      byAgent: agentRows.map((a) => ({
        agent: a.agent, runs: n(a.runs), completed: n(a.completed), failed: n(a.failed), waitingApproval: n(a.waiting),
        avgLatencyMs: a.avg_latency === null ? null : Math.round(Number(a.avg_latency)), tokens: n(a.tokens), costMicroUsd: n(a.cost),
      })),
    },
    approvals: {
      requested: n(appr?.requested),
      pending: n(appr?.pending),
      executed: n(appr?.executed),
      approvedNotExecuted: n(appr?.approved_not_executed),
      rejected: n(appr?.rejected),
      expired: n(appr?.expired),
      unknownOutcome: n(appr?.failed),
      medianDecisionMinutes: nOrNull(appr?.median_decision_min),
    },
    automations: {
      runs: autoRows.reduce((t, a) => t + n(a.runs), 0),
      byRule: autoRows.map((a) => ({ rule: a.rule, runs: n(a.runs), completed: n(a.completed), failed: n(a.failed), rateLimited: n(a.rate_limited) })),
    },
    ads: { spendMinor: n(ads?.spend), clicks: n(ads?.clicks), impressions: n(ads?.impressions), leads: n(ads?.leads) },
  };
}

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;

const fmtDay = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export function reportTitle(period: string, r: DateRange) {
  const label = period === "daily" ? "Daily report" : period === "weekly" ? "Weekly report" : period === "monthly" ? "Monthly report" : "Report";
  return r.from === r.to ? `${label} · ${fmtDay(r.from)}` : `${label} · ${fmtDay(r.from)} – ${fmtDay(r.to)}`;
}

/** Saves a report. Metrics are always recomputed here from the database, never supplied by the caller. */
export async function createReport(
  db: DbOrTx,
  input: { period: "daily" | "weekly" | "monthly" | "custom"; range: DateRange; narrative?: string | null; source: "user" | "agent" | "automation"; createdBy?: string | null; taskId?: string | null },
) {
  const metrics = await getAnalytics(db, input.range);
  const previous = await getAnalytics(db, previousRange(input.range));
  const [row] = await db
    .insert(analyticsReports)
    .values({
      period: input.period,
      fromDate: input.range.from,
      toDate: input.range.to,
      title: reportTitle(input.period, input.range),
      metrics: { ...metrics, previous: { range: previous.range, revenueMinor: previous.revenue.verifiedMinor, newLeads: previous.leads.new, won: previous.leads.won, agentRuns: previous.agents.runs } } as unknown as Record<string, unknown>,
      narrative: input.narrative ?? null,
      source: input.source,
      createdBy: input.createdBy ?? null,
      taskId: input.taskId ?? null,
    })
    .returning();
  return row!;
}
