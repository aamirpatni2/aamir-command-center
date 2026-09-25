import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Bot, CheckSquare, GraduationCap, ListChecks, PhoneCall, Sparkles, Users, Wallet, Activity, RefreshCw } from "lucide-react";
import { Card, EmptyState, StatTile, StatusBadge } from "@acc/ui";
import { api } from "../lib/api.js";
import { formatCount, formatMoney, formatDateTime, timeAgo } from "../lib/format.js";
import { PageHeader } from "../components/Layout.js";
import { useAuth } from "../lib/auth.js";

interface DashboardSummary {
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

function TileLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-accent [&>div]:hover:border-line-strong [&>div]:hover:bg-surface-2">
      {children}
    </Link>
  );
}

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function DashboardPage() {
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: ({ signal }) => api<DashboardSummary>("/api/dashboard/summary", { signal }),
    refetchInterval: 30_000,
  });

  const d = q.data;
  const c = d?.counts;
  const tz = d?.timezone ?? "Asia/Karachi";
  const v = (n: number | undefined) => (n === undefined ? "—" : formatCount(n));

  return (
    <>
      <PageHeader
        title={`${greeting(tz)}, ${session?.user.name.split(" ")[0] ?? ""}`}
        description={d ? `Live figures · updated ${formatDateTime(d.generatedAt, tz)} (Pakistan time)` : "Loading today's figures…"}
        action={
          <button
            onClick={() => void q.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
          >
            <RefreshCw className={q.isFetching ? "size-4 animate-spin" : "size-4"} aria-hidden /> Refresh
          </button>
        }
      />

      {q.isError && (
        <p role="alert" className="mb-4 rounded-lg border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-sm text-status-critical">
          Couldn't load the dashboard: {(q.error as Error).message}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <TileLink to="/analytics">
          <StatTile hero label="Revenue this month" icon={<Wallet className="size-4" />}
            value={d ? formatMoney(d.revenueThisMonth.amountMinor, d.revenueThisMonth.currency) : "—"}
            note="Verified payments only" />
        </TileLink>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2 lg:grid-cols-3">
          <TileLink to="/tasks"><StatTile label="Today's tasks" icon={<ListChecks className="size-4" />} value={v(c?.tasksOpen)} note="Queued, running or waiting" /></TileLink>
          <TileLink to="/leads"><StatTile label="New leads" icon={<Users className="size-4" />} value={v(c?.newLeadsToday)} note="Since midnight" /></TileLink>
          <TileLink to="/leads"><StatTile label="Pending follow-ups" icon={<PhoneCall className="size-4" />} value={v(c?.pendingFollowUps)} note="Due today or overdue" /></TileLink>
          <TileLink to="/students"><StatTile label="Students" icon={<GraduationCap className="size-4" />} value={v(c?.activeStudents)} note="Active" /></TileLink>
          <TileLink to="/agents"><StatTile label="Active agents" icon={<Bot className="size-4" />} value={v(c?.activeAgents)} note={`${v(c?.agentRunsToday)} runs today`} /></TileLink>
          <TileLink to="/approvals"><StatTile label="Pending approvals" icon={<CheckSquare className="size-4" />} value={v(c?.pendingApprovals)} note="Waiting for your decision" /></TileLink>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Pending approvals" action={<Link to="/approvals" className="text-xs text-accent hover:underline">Open Approval Center</Link>}>
          {d?.pendingApprovalItems.length ? (
            <ul className="divide-y divide-line">
              {d.pendingApprovalItems.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="truncate text-ink">{a.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={a.risk} />
                    <span className="text-xs text-ink-3">{timeAgo(a.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<CheckSquare className="size-6" />} title="Nothing waiting">
              When an agent wants to send, publish or spend, it will appear here first.
            </EmptyState>
          )}
        </Card>

        <Card title="Agent runs" action={<Link to="/agents" className="text-xs text-accent hover:underline">Agent activity</Link>}>
          {d?.recentRuns.length ? (
            <ul className="divide-y divide-line">
              {d.recentRuns.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-ink capitalize">{r.agentId} agent</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-ink-3">{timeAgo(r.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Activity className="size-6" />} title="No agent runs yet">
              The agent runtime arrives in Milestone 3. Runs will show up here live.
            </EmptyState>
          )}
        </Card>

        <Card title="AI insights">
          <EmptyState icon={<Sparkles className="size-6" />} title="No insights yet">
            The Analytics Agent (Milestone 12) will turn your real data into daily insights. Nothing is invented in the meantime.
          </EmptyState>
        </Card>
      </div>

      {d && d.openTasks.length > 0 && (
        <Card title="Open tasks" className="mt-4">
          <ul className="divide-y divide-line">
            {d.openTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="truncate text-ink">{t.title}</span>
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
