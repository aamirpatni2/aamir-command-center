import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, FileText, Plus } from "lucide-react";
import { Button, Card, EmptyState, StatTile, StatusBadge } from "@acc/ui";
import { Clock, TrendingUp, Users, Wallet } from "lucide-react";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime, formatMoney, formatUsd } from "../lib/format.js";
import { PageHeader } from "../components/Layout.js";
import type { AnalyticsData } from "./AnalyticsPage.js";

interface ReportRow { id: string; title: string; period: string; fromDate: string; toDate: string; source: string; hasNarrative: boolean; createdAt: string; taskId: string | null }
interface Report extends Omit<ReportRow, "hasNarrative"> { narrative: string | null; metrics: AnalyticsData & { previous: { revenueMinor: number; newLeads: number; won: number; agentRuns: number } } }

const SOURCE: Record<string, string> = { user: "Snapshot", agent: "Analytics Agent", automation: "Automation" };
const minutes = (m: number | null) => (m === null ? "—" : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);

function ReportDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["report", id], queryFn: ({ signal }) => api<{ report: Report }>(`/api/reports/${id}`, { signal }) });
  const r = q.data?.report;
  if (!r) return <p className="text-sm text-ink-3">{q.isError ? (q.error as Error).message : "Loading…"}</p>;
  const m = r.metrics;
  return (
    <>
      <Link to="/reports" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink"><ArrowLeft className="size-4" aria-hidden />All reports</Link>
      <PageHeader title={r.title} description={`${SOURCE[r.source] ?? r.source} · created ${formatDateTime(r.createdAt)} · figures computed by the server for ${r.fromDate} – ${r.toDate} (Pakistan time)`} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile tone="emerald" label="Verified revenue" icon={<Wallet className="size-4" />} value={formatMoney(m.revenue.verifiedMinor)} note={`previous period ${formatMoney(m.previous.revenueMinor)}`} />
        <StatTile tone="cyan" label="New leads" icon={<Users className="size-4" />} value={m.leads.new} note={`previous period ${m.previous.newLeads}`} />
        <StatTile tone="indigo" label="Won" icon={<TrendingUp className="size-4" />} value={m.leads.won} note={m.leads.conversionRate === null ? "—" : `${m.leads.conversionRate}% of new leads`} />
        <StatTile tone="amber" label="Median reply" icon={<Clock className="size-4" />} value={minutes(m.whatsapp.medianReplyMinutes)} note={`${m.whatsapp.answered}/${m.whatsapp.customerTurns} answered`} />
      </div>
      <Card title="Narrative" icon={<Bot className="size-4" />} className="mt-4">
        {r.narrative ? <div className="max-w-3xl text-sm leading-relaxed whitespace-pre-wrap text-ink">{r.narrative}</div> : <p className="text-sm text-ink-3">This is a numbers-only snapshot. Ask the Analytics Agent for a written report of the same period.</p>}
        {r.taskId && <Link to={`/tasks/${r.taskId}`} className="mt-3 inline-block text-xs text-accent hover:underline">See how the agent wrote it</Link>}
      </Card>
      <Card title="More figures" className="mt-4">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Payments verified", m.revenue.payments],
            ["Pending verification", formatMoney(m.revenue.pendingMinor)],
            ["Hot leads open", m.leads.hotOpen],
            ["WhatsApp messages in", m.whatsapp.inbound],
            ["New enrolments", m.students.newEnrollments],
            ["Attendance", m.students.attendanceRate === null ? "—" : `${m.students.attendanceRate}%`],
            ["Content published", m.content.published],
            ["Agent runs", `${m.agents.runs} (${m.agents.successRate ?? "—"}% ok)`],
            ["Agent cost", formatUsd(m.agents.costMicroUsd)],
            ["Approvals requested", m.approvals.requested],
            ["Executed", m.approvals.executed],
            ["Automation runs", m.automations.runs],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex justify-between gap-4 border-b border-line py-1.5"><dt className="text-ink-3">{k}</dt><dd className="tabular text-ink">{v}</dd></div>
          ))}
        </dl>
      </Card>
    </>
  );
}

export function ReportsPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ["reports"], queryFn: ({ signal }) => api<{ reports: ReportRow[] }>("/api/reports", { signal }), enabled: !id });
  const snap = useMutation({
    mutationFn: (b: { period: string; preset: string }) => api<{ report: { id: string } }>("/api/reports", { method: "POST", body: b }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["reports"] });
      navigate(`/reports/${r.report.id}`);
    },
  });
  const agent = useMutation({
    mutationFn: () => api<{ task: { id: string } }>("/api/reports/agent", { method: "POST", body: { preset: "last_week", period: "weekly" } }),
    onSuccess: (r) => navigate(`/tasks/${r.task.id}`),
  });
  if (id) return <ReportDetail id={id} />;
  const rows = list.data?.reports ?? [];

  return (
    <>
      <PageHeader
        title="Reports"
        description="Daily and weekly business reports. Numbers are always computed by the server; the Analytics Agent only adds the written narrative. A weekly report can run automatically (Automations → Weekly business report)."
        action={can("tasks:create") ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => snap.mutate({ period: "daily", preset: "yesterday" })} disabled={snap.isPending}><Plus className="size-4" aria-hidden />Yesterday</Button>
            <Button variant="secondary" onClick={() => snap.mutate({ period: "weekly", preset: "last_week" })} disabled={snap.isPending}><Plus className="size-4" aria-hidden />Last week</Button>
            <Button onClick={() => agent.mutate()} disabled={agent.isPending}><Bot className="size-4" aria-hidden />Written weekly report</Button>
          </div>
        ) : undefined}
      />
      {(snap.isError || agent.isError) && <p role="alert" className="mb-4 text-sm text-status-critical">{(snap.error ?? agent.error) instanceof ApiError ? ((snap.error ?? agent.error) as ApiError).message : "Failed"}</p>}
      <Card className="p-0">
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={`/reports/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-surface-2">
                  <span className="min-w-0"><span className="block truncate font-medium text-ink">{r.title}</span><span className="text-xs text-ink-3">{formatDateTime(r.createdAt)}</span></span>
                  <span className="flex shrink-0 items-center gap-2">
                    {r.hasNarrative && <StatusBadge status="completed" label="Written" />}
                    <StatusBadge status="neutral" label={SOURCE[r.source] ?? r.source} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<FileText className="size-5" />} title={list.isLoading ? "Loading…" : "No reports yet"}>Create a snapshot above, or ask the Analytics Agent for a written weekly report.</EmptyState>
        )}
      </Card>
    </>
  );
}
