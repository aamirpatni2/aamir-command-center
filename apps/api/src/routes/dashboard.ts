import type { FastifyInstance } from "fastify";
import { sql, type Database } from "@acc/database";
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
}

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
    };
  });
}
