import type { FastifyInstance } from "fastify";
import { sql, type Database } from "@acc/database";
import { BANDS } from "@acc/shared";
import { requireAuth } from "../plugins/auth.js";

/** Business day boundaries are Pakistan time, regardless of server time zone. */
export const BUSINESS_TZ = "Asia/Karachi";

export interface DashboardSummary {
  timezone: string;
  generatedAt: string;
  counts: {
    tasksOpen: number;
    newLeadsToday: number;
    pendingFollowUps: number;
    activeStudents: number;
    activeAgents: number;
    agentRunsToday: number;
    pendingApprovals: number;
  };
  revenueThisMonth: { amountMinor: number; currency: string };
  recentRuns: { id: string; agentId: string; status: string; createdAt: string; latencyMs: number | null }[];
  pendingApprovalItems: { id: string; title: string; risk: string; createdAt: string }[];
  openTasks: { id: string; title: string; status: string; createdAt: string }[];
  /** Chart series from real records only. Days are Pakistan calendar days, oldest first. */
  charts: {
    activity: { day: string; leads: number; inbound: number; runs: number }[];
    leadBands: { hot: number; warm: number; cold: number };
    leadSources: { source: string; count: number }[];
    approvals30d: Record<"pending" | "approved" | "executing" | "executed" | "rejected" | "expired" | "failed", number>;
  };
}

export const ACTIVITY_DAYS = 14;

export async function dashboardRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  app.get("/api/dashboard/summary", { preHandler: requireAuth("analytics:read") }, async (): Promise<DashboardSummary> => {
    const tz = BUSINESS_TZ;
    const dayStart = sql`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;
    const dayEnd = sql`(${dayStart} + interval '1 day')`;
    const monthStart = sql`(date_trunc('month', now() at time zone ${tz}) at time zone ${tz})`;

    const [counts] = await db.execute<Record<keyof DashboardSummary["counts"], string>>(sql`
      select
        (select count(*) from agent_tasks where status in ('QUEUED','RUNNING','WAITING_APPROVAL')) as "tasksOpen",
        (select count(*) from leads where deleted_at is null and created_at >= ${dayStart}) as "newLeadsToday",
        (select count(*) from leads where deleted_at is null and status not in ('won','lost')
            and next_follow_up_at is not null and next_follow_up_at < ${dayEnd}) as "pendingFollowUps",
        (select count(*) from students where deleted_at is null and status = 'active') as "activeStudents",
        (select count(distinct agent_id) from agent_runs where status = 'RUNNING') as "activeAgents",
        (select count(*) from agent_runs where created_at >= ${dayStart}) as "agentRunsToday",
        (select count(*) from approvals where status = 'pending') as "pendingApprovals"
    `);

    // Revenue counts verified payments only. Single currency (PKR) until multi-currency is needed.
    const [revenue] = await db.execute<{ amount: string | null }>(sql`
      select coalesce(sum(amount_minor), 0) as amount from payments
      where status = 'verified' and currency = 'PKR' and paid_at >= ${monthStart}
    `);

    const recentRuns = await db.execute<DashboardSummary["recentRuns"][number]>(sql`
      select id, agent_id as "agentId", status, created_at as "createdAt", latency_ms as "latencyMs"
      from agent_runs order by created_at desc limit 5
    `);
    const pendingApprovalItems = await db.execute<DashboardSummary["pendingApprovalItems"][number]>(sql`
      select id, title, risk, created_at as "createdAt" from approvals
      where status = 'pending' order by created_at asc limit 5
    `);
    const openTasks = await db.execute<DashboardSummary["openTasks"][number]>(sql`
      select id, title, status, created_at as "createdAt" from agent_tasks
      where status in ('QUEUED','RUNNING','WAITING_APPROVAL') order by priority desc, created_at asc limit 5
    `);

    // ── Charts ────────────────────────────────────────────────────────────
    const today = sql`date_trunc('day', now() at time zone ${tz})`;
    const since = sql`((${today} - make_interval(days => ${ACTIVITY_DAYS - 1})) at time zone ${tz})`;
    const activity = await db.execute<{ day: string; leads: string; inbound: string; runs: string }>(sql`
      with days as (
        select generate_series(${today} - make_interval(days => ${ACTIVITY_DAYS - 1}), ${today}, interval '1 day') as d
      ),
      l as (select date_trunc('day', created_at at time zone ${tz}) as d, count(*) as c from leads where deleted_at is null and created_at >= ${since} group by 1),
      m as (select date_trunc('day', created_at at time zone ${tz}) as d, count(*) as c from messages where direction = 'inbound' and created_at >= ${since} group by 1),
      r as (select date_trunc('day', created_at at time zone ${tz}) as d, count(*) as c from agent_runs where created_at >= ${since} group by 1)
      select to_char(days.d, 'YYYY-MM-DD') as day, coalesce(l.c, 0) as leads, coalesce(m.c, 0) as inbound, coalesce(r.c, 0) as runs
      from days left join l on l.d = days.d left join m on m.d = days.d left join r on r.d = days.d
      order by days.d
    `);
    const [bands] = await db.execute<{ hot: string; warm: string; cold: string }>(sql`
      select
        count(*) filter (where score >= ${BANDS.hot}) as hot,
        count(*) filter (where score >= ${BANDS.warm} and score < ${BANDS.hot}) as warm,
        count(*) filter (where score < ${BANDS.warm}) as cold
      from leads where deleted_at is null and status not in ('won', 'lost')
    `);
    const sources = await db.execute<{ source: string; count: string }>(sql`
      select source, count(*) as count from leads where deleted_at is null and status not in ('won', 'lost')
      group by source order by count(*) desc, source limit 6
    `);
    const approvalRows = await db.execute<{ status: string; count: string }>(sql`
      select status, count(*) as count from approvals where created_at >= now() - interval '30 days' group by status
    `);
    const approvals30d = { pending: 0, approved: 0, executing: 0, executed: 0, rejected: 0, expired: 0, failed: 0 };
    for (const r of approvalRows) if (r.status in approvals30d) approvals30d[r.status as keyof typeof approvals30d] = Number(r.count);

    const n = (v: string | undefined) => Number(v ?? 0);
    return {
      timezone: tz,
      generatedAt: new Date().toISOString(),
      counts: {
        tasksOpen: n(counts?.tasksOpen),
        newLeadsToday: n(counts?.newLeadsToday),
        pendingFollowUps: n(counts?.pendingFollowUps),
        activeStudents: n(counts?.activeStudents),
        activeAgents: n(counts?.activeAgents),
        agentRunsToday: n(counts?.agentRunsToday),
        pendingApprovals: n(counts?.pendingApprovals),
      },
      revenueThisMonth: { amountMinor: n(revenue?.amount ?? undefined), currency: "PKR" },
      recentRuns: [...recentRuns],
      pendingApprovalItems: [...pendingApprovalItems],
      openTasks: [...openTasks],
      charts: {
        activity: activity.map((a) => ({ day: a.day, leads: n(a.leads), inbound: n(a.inbound), runs: n(a.runs) })),
        leadBands: { hot: n(bands?.hot), warm: n(bands?.warm), cold: n(bands?.cold) },
        leadSources: sources.map((s) => ({ source: s.source, count: n(s.count) })),
        approvals30d,
      },
    };
  });
}
