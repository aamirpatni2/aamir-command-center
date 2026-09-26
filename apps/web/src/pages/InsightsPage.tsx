import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, Bot, CheckCircle2, Info, Sparkles } from "lucide-react";
import { Button, Card, cn, EmptyState } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { PageHeader } from "../components/Layout.js";

interface Insight { id: string; severity: "good" | "info" | "warning"; title: string; detail: string; link?: string }

const STYLE = {
  warning: { icon: AlertTriangle, cls: "border-status-warning/25 text-status-warning", glow: "bg-status-warning/15" },
  good: { icon: CheckCircle2, cls: "border-status-good/25 text-status-good", glow: "bg-status-good/15" },
  info: { icon: Info, cls: "border-accent/25 text-accent", glow: "bg-accent/15" },
};

export function InsightsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["insights"], queryFn: ({ signal }) => api<{ insights: Insight[]; range: { days: number } }>("/api/analytics/insights?preset=last_30_days", { signal }), refetchInterval: 60_000 });
  const ask = useMutation({
    mutationFn: () => api<{ task: { id: string } }>("/api/reports/agent", { method: "POST", body: { preset: "last_week", period: "weekly" } }),
    onSuccess: (r) => navigate(`/tasks/${r.task.id}`),
  });
  const items = q.data?.insights ?? [];

  return (
    <>
      <PageHeader
        title="AI Insights"
        description="Patterns in your last 30 days, calculated from your records by fixed rules (not guesses). An insight only appears when there's enough data for it to mean something."
        action={can("tasks:create") ? <Button variant="secondary" onClick={() => ask.mutate()} disabled={ask.isPending}><Bot className="size-4" aria-hidden />Ask the Analytics Agent for last week's report</Button> : undefined}
      />
      {ask.isError && <p role="alert" className="mb-4 text-sm text-status-critical">{ask.error instanceof ApiError ? ask.error.message : "Failed"}</p>}
      {q.isError && <p role="alert" className="text-sm text-status-critical">{(q.error as Error).message}</p>}
      {items.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {items.map((i) => {
            const s = STYLE[i.severity];
            const Icon = s.icon;
            return (
              <li key={i.id}>
                <Card className="h-full overflow-hidden">
                  <div aria-hidden className={cn("pointer-events-none absolute -top-12 -right-12 size-36 rounded-full blur-3xl", s.glow)} />
                  <div className="flex items-start gap-3">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl border bg-surface-2", s.cls)}><Icon className="size-4" aria-label={i.severity} /></span>
                    <div className="min-w-0">
                      <h2 className="font-display text-[15px] font-semibold text-ink">{i.title}</h2>
                      <p className="mt-1 text-sm leading-relaxed text-ink-2">{i.detail}</p>
                      {i.link && <Link to={i.link} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Open <ArrowUpRight className="size-3.5" aria-hidden /></Link>}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <Card>
          <EmptyState icon={<Sparkles className="size-5" />} title={q.isLoading ? "Loading…" : "No insights yet"}>
            Insights appear as your data grows: reply speed after 5 answered chats, best lead source after 10 leads, revenue trends once there are two periods to compare.
          </EmptyState>
        </Card>
      )}
    </>
  );
}
