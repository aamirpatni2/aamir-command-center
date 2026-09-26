import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, CheckSquare, Clock, GraduationCap, MessageCircle, PenSquare, TrendingUp, Users, Wallet, Workflow } from "lucide-react";
import { AreaChart, BarList, Card, cn, EmptyState, StatTile, type VizTone } from "@acc/ui";
import { api } from "../lib/api.js";
import { formatCount, formatMoney, formatUsd } from "../lib/format.js";
import { PageHeader } from "../components/Layout.js";
import { AgentChip } from "../components/AgentChip.js";

export interface AnalyticsData {
  range: { from: string; to: string; days: number };
  revenue: { verifiedMinor: number; pendingMinor: number; payments: number; byDay: { day: string; minor: number }[]; byCourse: { course: string; minor: number; payments: number }[] };
  leads: { new: number; won: number; lost: number; hotOpen: number; conversionRate: number | null; funnel: { stage: string; count: number }[]; bySource: { source: string; leads: number; won: number; conversionRate: number | null }[]; byDay: { day: string; leads: number }[] };
  whatsapp: { inbound: number; outbound: number; conversations: number; customerTurns: number; answered: number; answeredRate: number | null; medianReplyMinutes: number | null; p90ReplyMinutes: number | null };
  students: { newEnrollments: number; activeStudents: number; classesHeld: number; attendanceRate: number | null };
  content: { created: number; published: number; byType: { type: string; created: number; published: number }[] };
  agents: { runs: number; completed: number; failed: number; successRate: number | null; tokens: number; costMicroUsd: number; mockRuns: number; byAgent: { agent: string; runs: number; completed: number; failed: number; waitingApproval: number; avgLatencyMs: number | null; tokens: number; costMicroUsd: number }[] };
  approvals: { requested: number; pending: number; executed: number; approvedNotExecuted: number; rejected: number; expired: number; unknownOutcome: number; medianDecisionMinutes: number | null };
  automations: { runs: number; byRule: { rule: string; runs: number; completed: number; failed: number; rateLimited: number }[] };
}

const RANGES = [
  { id: "last_7_days", label: "7 days" },
  { id: "last_30_days", label: "30 days" },
  { id: "last_90_days", label: "90 days" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
] as const;

const TONES: VizTone[] = ["indigo", "cyan", "emerald", "amber", "fuchsia", "rose", "sky", "violet"];
const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const minutes = (m: number | null) => (m === null ? "—" : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);

/** "vs previous period" only when there is a previous value to compare with (never an invented trend). */
function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  if (!before) return <span className="text-ink-3">no earlier data to compare</span>;
  const change = Math.round(((now - before) / before) * 100);
  const good = invert ? change < 0 : change > 0;
  return <span className={cn(change === 0 ? "text-ink-3" : good ? "text-status-good" : "text-status-serious")}>{change > 0 ? "+" : ""}{change}% vs previous period</span>;
}

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const preset = RANGES.find((r) => r.id === params.get("range"))?.id ?? "last_30_days";
  const q = useQuery({
    queryKey: ["analytics", preset],
    queryFn: ({ signal }) => api<{ current: AnalyticsData; previous: AnalyticsData }>(`/api/analytics?preset=${preset}`, { signal }),
  });
  const a = q.data?.current;
  const p = q.data?.previous;
  const loading = !a;

  return (
    <>
      <PageHeader
        title="Analytics"
        description={a ? `${dayLabel(a.range.from)} – ${dayLabel(a.range.to)} · Pakistan time · every figure comes from your records; only verified payments count as revenue.` : "Loading…"}
        action={
          <div role="tablist" aria-label="Period" className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1">
            {RANGES.map((r) => (
              <button key={r.id} role="tab" aria-selected={preset === r.id} onClick={() => setParams({ range: r.id })}
                className={cn("rounded-lg px-3 py-1 text-xs transition", preset === r.id ? "bg-accent/20 text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-ink-3 hover:text-ink")}>
                {r.label}
              </button>
            ))}
          </div>
        }
      />
      {q.isError && <p role="alert" className="mb-4 text-sm text-status-critical">{(q.error as Error).message}</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile tone="emerald" loading={loading} label="Verified revenue" icon={<Wallet className="size-4" />} value={a ? formatMoney(a.revenue.verifiedMinor) : "—"} note={a && p ? <Delta now={a.revenue.verifiedMinor} before={p.revenue.verifiedMinor} /> : null} />
        <StatTile tone="cyan" loading={loading} label="New leads" icon={<Users className="size-4" />} value={a ? formatCount(a.leads.new) : "—"} note={a && p ? <Delta now={a.leads.new} before={p.leads.new} /> : null} />
        <StatTile tone="indigo" loading={loading} label="Lead → won" icon={<TrendingUp className="size-4" />} value={a ? (a.leads.conversionRate === null ? "—" : `${a.leads.conversionRate}%`) : "—"} note={a ? `${a.leads.won} won of ${a.leads.new} new (current status)` : null} />
        <StatTile tone="amber" loading={loading} label="Median WhatsApp reply" icon={<Clock className="size-4" />} value={a ? minutes(a.whatsapp.medianReplyMinutes) : "—"} note={a ? `${a.whatsapp.answered} of ${a.whatsapp.customerTurns} customer messages answered` : null} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Verified revenue by day (PKR)" icon={<Wallet className="size-4" />}>
          {a && a.revenue.verifiedMinor > 0 ? (
            <AreaChart label="Verified revenue by day" data={a.revenue.byDay.map((d) => ({ day: d.day, pkr: Math.round(d.minor / 100) }))} series={[{ key: "pkr", label: "Revenue (PKR)", tone: "emerald" }]} xLabel={(d) => dayLabel(d.day)} height={200} />
          ) : (
            <EmptyState icon={<Wallet className="size-5" />} title={loading ? "Loading…" : "No verified payments in this period"}>{a && a.revenue.pendingMinor > 0 ? `${formatMoney(a.revenue.pendingMinor)} is waiting to be verified.` : "Revenue appears once payments are verified."}</EmptyState>
          )}
        </Card>
        <Card title="New leads by day" icon={<Users className="size-4" />}>
          {a && a.leads.new > 0 ? (
            <AreaChart label="New leads by day" data={a.leads.byDay} series={[{ key: "leads", label: "New leads", tone: "cyan" }]} xLabel={(d) => dayLabel(d.day)} height={200} />
          ) : (
            <EmptyState icon={<Users className="size-5" />} title={loading ? "Loading…" : "No new leads in this period"} />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Lead funnel" icon={<TrendingUp className="size-4" />} action={<span className="text-xs text-ink-3">leads created in the period</span>}>
          {a && a.leads.new > 0 ? <BarList label="Lead funnel" items={a.leads.funnel.map((f, i) => ({ key: f.stage, label: f.stage, value: f.count, tone: (["indigo", "sky", "cyan", "emerald"] as VizTone[])[i] }))} /> : <EmptyState icon={<TrendingUp className="size-5" />} title="No leads yet" />}
        </Card>
        <Card title="Where leads come from" icon={<Users className="size-4" />}>
          {a?.leads.bySource.length ? (
            <ul className="space-y-2.5 text-sm">
              {a.leads.bySource.map((s, i) => (
                <li key={s.source} className="flex items-center gap-3">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--color-viz-${TONES[i % TONES.length]})` }} aria-hidden />
                  <span className="flex-1 truncate text-ink-2 capitalize">{s.source === "whatsapp" ? "WhatsApp" : s.source}</span>
                  <span className="tabular text-ink">{s.leads}</span>
                  <span className="tabular w-24 text-right text-xs text-ink-3">{s.won} won{s.conversionRate !== null ? ` · ${s.conversionRate}%` : ""}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<Users className="size-5" />} title="No leads yet" />}
        </Card>
        <Card title="Revenue by course" icon={<GraduationCap className="size-4" />}>
          {a?.revenue.byCourse.length ? <BarList label="Revenue by course" format={(v) => formatMoney(v)} items={a.revenue.byCourse.map((c, i) => ({ key: c.course, label: c.course, value: c.minor, tone: TONES[(i + 2) % TONES.length] }))} /> : <EmptyState icon={<GraduationCap className="size-5" />} title="No verified revenue" />}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile tone="violet" loading={loading} label="New enrolments" icon={<GraduationCap className="size-4" />} value={a?.students.newEnrollments ?? "—"} note={a ? `${a.students.activeStudents} active students now` : null} />
        <StatTile tone="sky" loading={loading} label="Class attendance" icon={<GraduationCap className="size-4" />} value={a ? (a.students.attendanceRate === null ? "—" : `${a.students.attendanceRate}%`) : "—"} note={a ? `${a.students.classesHeld} class(es) held` : null} />
        <StatTile tone="fuchsia" loading={loading} label="Content published" icon={<PenSquare className="size-4" />} value={a?.content.published ?? "—"} note={a ? `${a.content.created} created` : null} />
        <StatTile tone="cyan" loading={loading} label="WhatsApp messages in" icon={<MessageCircle className="size-4" />} value={a ? formatCount(a.whatsapp.inbound) : "—"} note={a ? `${a.whatsapp.conversations} conversations · p90 reply ${minutes(a.whatsapp.p90ReplyMinutes)}` : null} />
      </div>

      <Card title="Agent performance" icon={<Bot className="size-4" />} className="mt-4 p-0 [&>header]:px-5 [&>header]:pt-5" action={a ? <span className="text-xs text-ink-3">{a.agents.runs} runs · {a.agents.successRate === null ? "—" : `${a.agents.successRate}% succeeded`} · {formatUsd(a.agents.costMicroUsd)}{a.agents.mockRuns ? ` · ${a.agents.mockRuns} on the mock model` : ""}</span> : null}>
        {a?.agents.byAgent.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line"><tr>{["Agent", "Runs", "Completed", "Failed", "Waiting approval", "Avg time", "Tokens", "Cost"].map((h) => <th key={h} className="px-5 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {a.agents.byAgent.map((g) => (
                  <tr key={g.agent}>
                    <td className="px-5 py-2"><AgentChip id={g.agent} suffix="" /></td>
                    <td className="tabular px-5 py-2 text-ink">{g.runs}</td>
                    <td className="tabular px-5 py-2 text-status-good">{g.completed}</td>
                    <td className={cn("tabular px-5 py-2", g.failed ? "text-status-critical" : "text-ink-3")}>{g.failed}</td>
                    <td className="tabular px-5 py-2 text-ink-2">{g.waitingApproval}</td>
                    <td className="tabular px-5 py-2 text-ink-2">{g.avgLatencyMs === null ? "—" : `${(g.avgLatencyMs / 1000).toFixed(1)} s`}</td>
                    <td className="tabular px-5 py-2 text-ink-2">{formatCount(g.tokens)}</td>
                    <td className="tabular px-5 py-2 text-ink-2">{formatUsd(g.costMicroUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon={<Bot className="size-5" />} title="No agent runs in this period" />}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Approvals" icon={<CheckSquare className="size-4" />} action={a?.approvals.medianDecisionMinutes !== null && a ? <span className="text-xs text-ink-3">median decision {minutes(a.approvals.medianDecisionMinutes)}</span> : null}>
          {a && a.approvals.requested > 0 ? (
            <BarList label="Approval outcomes" items={[
              { key: "executed", label: "Executed", value: a.approvals.executed, tone: "emerald" as VizTone },
              { key: "pending", label: "Waiting", value: a.approvals.pending, tone: "amber" as VizTone },
              { key: "approved", label: "Approved, not sent", value: a.approvals.approvedNotExecuted, tone: "cyan" as VizTone },
              { key: "rejected", label: "Rejected", value: a.approvals.rejected, tone: "rose" as VizTone },
              { key: "expired", label: "Expired / superseded", value: a.approvals.expired, tone: "violet" as VizTone },
              { key: "failed", label: "Outcome unknown", value: a.approvals.unknownOutcome, tone: "fuchsia" as VizTone },
            ].filter((x) => x.value > 0)} />
          ) : <EmptyState icon={<CheckSquare className="size-5" />} title="No approval requests in this period" />}
        </Card>
        <Card title="Automations" icon={<Workflow className="size-4" />} action={a ? <span className="text-xs text-ink-3">{a.automations.runs} runs</span> : null}>
          {a?.automations.byRule.length ? (
            <ul className="space-y-2 text-sm">
              {a.automations.byRule.map((r) => (
                <li key={r.rule} className="flex items-center justify-between gap-3">
                  <span className="truncate text-ink-2">{r.rule}</span>
                  <span className="tabular shrink-0 text-xs text-ink-3"><span className="text-ink">{r.runs}</span> runs{r.failed ? ` · ${r.failed} failed` : ""}{r.rateLimited ? ` · ${r.rateLimited} rate-limited` : ""}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<Workflow className="size-5" />} title="No automation runs in this period" />}
        </Card>
      </div>
      <p className="mt-4 text-xs text-ink-3">Lead conversion uses each lead's current status. Reply time counts a burst of customer messages as one message and measures to the next reply sent.</p>
    </>
  );
}
