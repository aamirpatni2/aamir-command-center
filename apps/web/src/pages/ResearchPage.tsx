import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Telescope } from "lucide-react";
import { Card, EmptyState, StatusBadge } from "@acc/ui";
import { api } from "../lib/api.js";
import { formatDateTime } from "../lib/format.js";
import { PageHeader } from "../components/Layout.js";

interface ReportRow { id: string; title: string; summary: string; taskId: string | null; createdAt: string; counts: { verified: number; unverified: number; contradicted: number } }
interface Report { id: string; title: string; summary: string; taskId: string | null; createdAt: string; teachingNotes: string | null; claims: { claim: string; status: "verified" | "unverified" | "contradicted"; sources: { url: string; title?: string }[]; note?: string }[] }

function Detail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["research", id], queryFn: ({ signal }) => api<{ report: Report }>(`/api/research/${id}`, { signal }) });
  if (!q.data) return <p className="text-sm text-ink-3">{q.isError ? (q.error as Error).message : "Loading…"}</p>;
  const r = q.data.report;
  return (
    <>
      <Link to="/research" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> AI Research</Link>
      <PageHeader title={r.title} description={`${formatDateTime(r.createdAt)}`} action={r.taskId && <Link to={`/tasks/${r.taskId}`} className="text-sm text-accent hover:underline">See the task →</Link>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Summary"><p className="text-sm whitespace-pre-wrap text-ink">{r.summary}</p></Card>
          <Card title={`Claims (${r.claims.length})`}>
            <ul className="divide-y divide-line">
              {r.claims.map((c, i) => (
                <li key={i} className="py-3">
                  <div className="flex items-start gap-2">
                    <StatusBadge status={c.status === "verified" ? "verified_claim" : c.status} className="shrink-0" />
                    <p className="text-sm text-ink">{c.claim}</p>
                  </div>
                  {c.sources.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 pl-1">
                      {c.sources.map((s) => (
                        <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-accent hover:underline"><ExternalLink className="size-3" aria-hidden />{s.title ?? new URL(s.url).hostname}</a></li>
                      ))}
                    </ul>
                  )}
                  {c.note && <p className="mt-1 text-xs text-ink-3">{c.note}</p>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card title="Teaching notes"><p className="text-sm whitespace-pre-wrap text-ink-2">{r.teachingNotes ?? "—"}</p></Card>
      </div>
    </>
  );
}

export function ResearchPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["research"], queryFn: ({ signal }) => api<{ reports: ReportRow[] }>("/api/research", { signal }), enabled: !id });
  if (id) return <Detail id={id} />;
  return (
    <>
      <PageHeader title="AI Research" description="Reports from the Research Agent. A claim is 'verified' only if its source was actually opened in that run; anything else is marked unverified automatically." />
      {q.data?.reports.length ? (
        <div className="space-y-3">
          {q.data.reports.map((r) => (
            <Link key={r.id} to={`/research/${r.id}`} className="block rounded-xl border border-line bg-surface p-4 hover:border-line-strong hover:bg-surface-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{r.title}</span>
                <span className="ml-auto flex gap-1.5">
                  <StatusBadge status="verified_claim" label={`${r.counts.verified} verified`} />
                  <StatusBadge status="unverified" label={`${r.counts.unverified} unverified`} />
                  {r.counts.contradicted > 0 && <StatusBadge status="contradicted" label={`${r.counts.contradicted} contradicted`} />}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-ink-2">{r.summary}</p>
              <p className="mt-1 text-xs text-ink-3">{formatDateTime(r.createdAt)}</p>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<Telescope className="size-6" />} title={q.isLoading ? "Loading…" : "No research yet"}>
            Ask on the Tasks page, e.g. "Aaj ki important AI news dhoondo aur verify karo". Live web research needs BRAVE_API_KEY or TAVILY_API_KEY.
          </EmptyState>
        </Card>
      )}
    </>
  );
}
