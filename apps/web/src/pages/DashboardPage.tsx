import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Activity, ArrowUpRight, Bot, CheckSquare, Flame, GraduationCap, ListChecks, PhoneCall, RefreshCw, ShieldCheck, Users, Wallet, Waypoints,
} from "lucide-react";
import { AreaChart, BarList, Card, DonutChart, EmptyState, StatTile, StatusBadge, type VizTone } from "@acc/ui";
import { api } from "../lib/api.js";
import { formatCount, formatMoney, formatDateTime, timeAgo } from "../lib/format.js";
import { PageHeader } from "../components/Layout.js";
import { AgentChip } from "../components/AgentChip.js";
import { useAuth } from "../lib/auth.js";

type ApprovalStatusCount = Record<"pending" | "approved" | "executing" | "executed" | "rejected" | "expired" | "failed", number>;

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
  charts: {
    activity: { day: string; leads: number; inbound: number; runs: number }[];
    leadBands: { hot: number; warm: number; cold: number };
    leadSources: { source: string; count: number }[];
    approvals30d: ApprovalStatusCount;
  };
}

const SOURCE_TONE: Record<string, VizTone> = { whatsapp: "emerald", facebook: "sky", instagram: "fuchsia", youtube: "rose", website: "cyan", referral: "amber" };
const SOURCE_LABEL: Record<string, string> = { whatsapp: "WhatsApp", facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", website: "Website", referral: "Referral" };
const APPROVAL_BARS: { key: keyof ApprovalStatusCount; label: string; tone: VizTone }[] = [
  { key: "executed", label: "Executed", tone: "emerald" },
  { key: "pending", label: "Waiting for you", tone: "amber" },
  { key: "approved", label: "Approved, not sent yet", tone: "cyan" },
  { key: "rejected", label: "Rejected", tone: "rose" },
  { key: "expired", label: "Expired / superseded", tone: "violet" },
  { key: "failed", label: "Outcome unknown", tone: "fuchsia" },
];

const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function TileLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="group block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      {children}
    </Link>
  );
}

function CardLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium whitespace-nowrap text-accent transition hover:bg-accent/10">
      {children} <ArrowUpRight className="size-3.5" aria-hidden />
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
  const loading = !d && q.isLoading;
  const v = (n: number | undefined) => (n === undefined ? "—" : formatCount(n));
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date());

  const activity = d?.charts.activity ?? [];
  const hasActivity = activity.some((a) => a.leads + a.inbound + a.runs > 0);
  const bands = d?.charts.leadBands;
  const bandTotal = bands ? bands.hot + bands.warm + bands.cold : 0;
  const approvals = d?.charts.approvals30d;
  const approvalTotal = approvals ? Object.values(approvals).reduce((t, n) => t + n, 0) : 0;

  return (
    <>
      <PageHeader
        eyebrow={today}
        title={`${greeting(tz)}, ${session?.user.name.split(" ")[0] ?? ""}`}
        description="Everything your agents did, and everything waiting for you, from live records."
        action={
          <div className="flex items-center gap-2">
            {d && (
              <span className="hidden items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2 sm:inline-flex">
                <span className="size-1.5 animate-pulse-dot rounded-full bg-status-good" aria-hidden />
                Live · {formatDateTime(d.generatedAt, tz)}
              </span>
            )}
            <button
              onClick={() => void q.refetch()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink-2 transition hover:border-line-strong hover:text-ink active:scale-[0.97]"
            >
              <RefreshCw className={q.isFetching ? "size-4 animate-spin" : "size-4"} aria-hidden /> Refresh
            </button>
          </div>
        }
      />

      {q.isError && (
        <p role="alert" className="mb-5 rounded-xl border border-status-critical/30 bg-status-critical/10 px-4 py-3 text-sm text-status-critical">
          Couldn't load the dashboard: {(q.error as Error).message}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <TileLink to="/analytics">
          <StatTile
            hero
            tone="emerald"
            loading={loading}
            label="Revenue this month"
            icon={<Wallet className="size-4" />}
            value={d ? formatMoney(d.revenueThisMonth.amountMinor, d.revenueThisMonth.currency) : "—"}
            note={<span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-status-good" aria-hidden /> Verified payments only</span>}
          />
        </TileLink>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2 lg:grid-cols-3">
          <TileLink to="/tasks"><StatTile tone="indigo" loading={loading} label="Open tasks" icon={<ListChecks className="size-4" />} value={v(c?.tasksOpen)} note="Queued, running or waiting" /></TileLink>
          <TileLink to="/leads"><StatTile tone="cyan" loading={loading} label="New leads" icon={<Users className="size-4" />} value={v(c?.newLeadsToday)} note="Since midnight" /></TileLink>
          <TileLink to="/leads"><StatTile tone="amber" loading={loading} label="Follow-ups due" icon={<PhoneCall className="size-4" />} value={v(c?.pendingFollowUps)} note="Today or overdue" /></TileLink>
          <TileLink to="/students"><StatTile tone="violet" loading={loading} label="Students" icon={<GraduationCap className="size-4" />} value={v(c?.activeStudents)} note="Active" /></TileLink>
          <TileLink to="/agents"><StatTile tone="sky" loading={loading} label="Agents working" icon={<Bot className="size-4" />} value={v(c?.activeAgents)} note={`${v(c?.agentRunsToday)} runs today`} /></TileLink>
          <TileLink to="/approvals"><StatTile tone="rose" loading={loading} label="Approvals" icon={<CheckSquare className="size-4" />} value={v(c?.pendingApprovals)} note="Waiting for your decision" /></TileLink>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Activity · last 14 days" icon={<Activity className="size-4" />} className="lg:col-span-2" action={<CardLink to="/agents">Agent activity</CardLink>}>
          {loading ? (
            <div className="shimmer h-[252px] rounded-xl" />
          ) : hasActivity ? (
            <AreaChart
              label="Daily activity over the last 14 days"
              data={activity}
              xLabel={(a) => dayLabel(a.day)}
              series={[
                { key: "inbound", label: "WhatsApp messages in", tone: "cyan" },
                { key: "leads", label: "New leads", tone: "emerald" },
                { key: "runs", label: "Agent runs", tone: "indigo" },
              ]}
            />
          ) : (
            <EmptyState icon={<Activity className="size-5" />} title="No activity in the last 14 days">
              Messages, new leads and agent runs will be charted here day by day.
            </EmptyState>
          )}
        </Card>

        <Card title="Lead temperature" icon={<Flame className="size-4" />} action={<CardLink to="/leads">Leads</CardLink>}>
          {loading ? (
            <div className="shimmer h-[252px] rounded-xl" />
          ) : bands && bandTotal > 0 ? (
            <DonutChart
              label="Open leads by temperature"
              centerLabel="open leads"
              segments={[
                { label: "Hot", value: bands.hot, tone: "rose" },
                { label: "Warm", value: bands.warm, tone: "amber" },
                { label: "Cold", value: bands.cold, tone: "sky" },
              ]}
            />
          ) : (
            <EmptyState icon={<Flame className="size-5" />} title="No open leads">Scored leads are grouped into hot, warm and cold here.</EmptyState>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Needs your approval" icon={<CheckSquare className="size-4" />} action={<CardLink to="/approvals">Review</CardLink>}>
          {d?.pendingApprovalItems.length ? (
            <ul className="-mx-2 space-y-0.5">
              {d.pendingApprovalItems.map((a) => (
                <li key={a.id}>
                  <Link to="/approvals" className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm transition hover:bg-surface-2">
                    <span className="truncate text-ink">{a.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={a.risk} />
                      <span className="text-xs text-ink-3">{timeAgo(a.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<CheckSquare className="size-5" />} title="Nothing waiting">
              When an agent wants to send, publish or spend, it appears here first.
            </EmptyState>
          )}
        </Card>

        <Card title="Latest agent runs" icon={<Bot className="size-4" />} action={<CardLink to="/agents">All runs</CardLink>}>
          {d?.recentRuns.length ? (
            <ul className="-mx-2 space-y-0.5">
              {d.recentRuns.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-sm transition hover:bg-surface-2">
                  <AgentChip id={r.agentId} suffix="" />
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={r.status} />
                    <span className="w-14 text-right text-xs text-ink-3">{timeAgo(r.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Activity className="size-5" />} title="No agent runs yet">
              Give the Orchestrator a task on the <Link to="/tasks" className="text-accent hover:underline">Tasks</Link> page and its runs appear here.
            </EmptyState>
          )}
        </Card>

        <Card title="Lead sources" icon={<Waypoints className="size-4" />} action={<span className="text-xs text-ink-3">open leads</span>}>
          {d?.charts.leadSources.length ? (
            <BarList
              label="Open leads by source"
              items={d.charts.leadSources.map((s) => ({ key: s.source, label: SOURCE_LABEL[s.source] ?? s.source, value: s.count, tone: SOURCE_TONE[s.source] ?? "indigo" }))}
            />
          ) : (
            <EmptyState icon={<Waypoints className="size-5" />} title="No open leads yet">Lead sources appear once enquiries arrive.</EmptyState>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Open tasks" icon={<ListChecks className="size-4" />} className="lg:col-span-2" action={<CardLink to="/tasks">Tasks</CardLink>}>
          {d?.openTasks.length ? (
            <ul className="-mx-2 space-y-0.5">
              {d.openTasks.map((t) => (
                <li key={t.id}>
                  <Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm transition hover:bg-surface-2">
                    <span className="truncate text-ink">{t.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={t.status} />
                      <span className="w-14 text-right text-xs text-ink-3">{timeAgo(t.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<ListChecks className="size-5" />} title="No open tasks">Everything the agents were asked to do is finished.</EmptyState>
          )}
        </Card>

        <Card title="Approvals · last 30 days" icon={<ShieldCheck className="size-4" />}>
          {approvals && approvalTotal > 0 ? (
            <BarList
              label="Approval outcomes in the last 30 days"
              items={APPROVAL_BARS.filter((b) => approvals[b.key] > 0).map((b) => ({ key: b.key, label: b.label, value: approvals[b.key], tone: b.tone }))}
            />
          ) : (
            <EmptyState icon={<ShieldCheck className="size-5" />} title="No requests yet">How your approval decisions turned out will show here.</EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}
