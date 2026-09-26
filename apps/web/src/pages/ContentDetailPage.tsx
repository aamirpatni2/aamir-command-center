import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Copy, Info } from "lucide-react";
import { Button, Card, StatusBadge } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime } from "../lib/format.js";
import { LANG_LABEL, TYPE_LABEL, type ContentItem } from "../lib/content-types.js";
import { PageHeader } from "../components/Layout.js";
import { pktToIso } from "../components/Form.js";

const ACTIONS: Record<string, { to: string; label: string; approve?: boolean; variant?: "primary" | "secondary" | "danger" }[]> = {
  draft: [{ to: "in_review", label: "Submit for review", variant: "secondary" }, { to: "approved", label: "Approve", approve: true }, { to: "rejected", label: "Reject", approve: true, variant: "danger" }],
  in_review: [{ to: "approved", label: "Approve", approve: true }, { to: "rejected", label: "Reject", approve: true, variant: "danger" }, { to: "draft", label: "Back to draft", variant: "secondary" }],
  approved: [{ to: "published", label: "Mark as published", approve: true, variant: "secondary" }, { to: "draft", label: "Back to draft", variant: "secondary" }],
  scheduled: [{ to: "published", label: "Mark as published", approve: true }, { to: "approved", label: "Unschedule", approve: true, variant: "secondary" }],
  rejected: [{ to: "draft", label: "Reopen as draft", variant: "secondary" }],
  published: [],
};

function Structured({ item }: { item: ContentItem }) {
  const f = item.data.format;
  if (item.type === "reel") {
    return (
      <div className="space-y-3 text-sm">
        <p><span className="text-xs text-ink-3">HOOK (0–3s) </span><span className="text-ink">{f.hook}</span></p>
        <table className="w-full text-left">
          <thead className="text-xs text-ink-3"><tr><th className="py-1 pr-3 font-medium">Time</th><th className="py-1 pr-3 font-medium">Voiceover</th><th className="py-1 pr-3 font-medium">On screen</th><th className="py-1 font-medium">Visual</th></tr></thead>
          <tbody className="divide-y divide-line align-top">
            {f.beats.map((b: any, i: number) => (
              <tr key={i}><td className="tabular py-1.5 pr-3 whitespace-nowrap text-ink-3">{b.start}–{b.end}s</td><td className="py-1.5 pr-3 text-ink">{b.voiceover}</td><td className="py-1.5 pr-3 text-ink-2">{b.onScreenText ?? ""}</td><td className="py-1.5 text-ink-2">{b.visual ?? ""}</td></tr>
            ))}
          </tbody>
        </table>
        <p><span className="text-xs text-ink-3">CTA </span><span className="text-ink">{f.cta}</span></p>
        <p className="whitespace-pre-wrap"><span className="text-xs text-ink-3">CAPTION </span><span className="text-ink">{f.caption}</span></p>
        {f.hashtags?.length > 0 && <p className="text-accent">{f.hashtags.map((h: string) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}</p>}
      </div>
    );
  }
  if (item.type === "script") {
    return (
      <div className="space-y-4 text-sm">
        {f.thumbnailText && <p><span className="text-xs text-ink-3">THUMBNAIL </span><span className="text-ink">{f.thumbnailText}</span>{f.thumbnailVisual && <span className="text-ink-2"> · {f.thumbnailVisual}</span>}</p>}
        {f.sections.map((s: any, i: number) => (
          <section key={i}>
            <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{s.heading}{s.timing ? ` · ${s.timing}` : ""}</h3>
            <p className="mt-1 whitespace-pre-wrap text-ink">{s.content}</p>
            {s.broll && <p className="mt-1 text-xs text-ink-2">[B-ROLL: {s.broll}]</p>}
          </section>
        ))}
        <p><span className="text-xs text-ink-3">CTA </span><span className="text-ink">{f.cta}</span></p>
      </div>
    );
  }
  if (item.type === "carousel") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {f.slides.map((s: any, i: number) => (
          <div key={i} className="rounded-lg border border-line p-3"><div className="text-xs text-ink-3">Slide {i + 1}</div><div className="text-sm font-medium text-ink">{s.heading}</div><p className="text-sm text-ink-2">{s.text}</p></div>
        ))}
      </div>
    );
  }
  return <p className="text-sm whitespace-pre-wrap text-ink">{item.body}</p>;
}

export function ContentDetailPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["content-item", id], queryFn: ({ signal }) => api<{ item: ContentItem }>(`/api/content/${id}`, { signal }) });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [when, setWhen] = useState("");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (q.data) setText(q.data.item.body); }, [q.data]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["content-item", id] }); void qc.invalidateQueries({ queryKey: ["content"] }); };
  const onError = (e: unknown) => setMsg(e instanceof ApiError ? e.message : "Failed");
  const save = useMutation({ mutationFn: () => api(`/api/content/${id}`, { method: "PATCH", body: { body: text } }), onSuccess: () => { setEditing(false); setMsg("Saved. Checks re-run."); refresh(); }, onError });
  const move = useMutation({ mutationFn: (body: Record<string, unknown>) => api(`/api/content/${id}/status`, { method: "POST", body }), onSuccess: () => { setMsg(null); refresh(); }, onError });

  if (!q.data) return <p className="text-sm text-ink-3">{q.isError ? (q.error as Error).message : "Loading…"}</p>;
  const { item } = q.data;
  const checks = item.data.checks ?? [];

  return (
    <>
      <Link to="/content" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Content</Link>
      <PageHeader
        title={item.title ?? TYPE_LABEL[item.type] ?? "Content"}
        description={`${TYPE_LABEL[item.type]} · ${LANG_LABEL[item.language]}${item.platform ? ` · ${item.platform}` : ""} · by ${item.data.createdBy === "agent" ? "Content Agent" : "a person"}${item.data.edited ? " (edited)" : ""} · ${formatDateTime(item.createdAt)}`}
        action={<StatusBadge status={item.status} />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card
            title="Content"
            action={
              <div className="flex gap-2">
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void navigator.clipboard.writeText(item.body).then(() => setMsg("Copied"))}><Copy className="size-3.5" aria-hidden /> Copy</Button>
                {can("content:write") && item.status !== "published" && !editing && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(true)}>Edit text</Button>}
              </div>
            }
          >
            {editing ? (
              <div className="space-y-2">
                <textarea aria-label="Content text" value={text} onChange={(e) => setText(e.target.value)} rows={16} className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm text-ink" />
                <div className="flex gap-2"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button><Button variant="secondary" onClick={() => { setEditing(false); setText(item.body); }}>Cancel</Button></div>
                {["approved", "scheduled"].includes(item.status) && <p className="text-xs text-status-warning">Saving changes sends this back to review.</p>}
              </div>
            ) : item.data.edited ? (
              <p className="text-sm whitespace-pre-wrap text-ink">{item.body}</p>
            ) : (
              <Structured item={item} />
            )}
          </Card>
          {item.sources.length > 0 && (
            <Card title="Sources">
              <ul className="space-y-1 text-sm">{item.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{s.title ?? s.url}</a></li>)}</ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title={`Checks (${checks.length})`}>
            {checks.length ? (
              <ul className="space-y-2 text-sm">
                {checks.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    {c.level === "warn" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-warning" aria-label="warning" /> : <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-label="note" />}
                    <span className="text-ink-2">{c.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">No issues found by the automatic checks (language, AI phrasing, income/guarantee/scarcity claims, unsourced stats). A person still reviews tone and facts.</p>
            )}
          </Card>

          <Card title="Workflow">
            <div className="flex flex-wrap gap-2">
              {(ACTIONS[item.status] ?? []).filter((a) => (a.approve ? can("content:approve") : can("content:write"))).map((a) => (
                <Button key={a.to} variant={a.variant ?? "primary"} disabled={move.isPending} onClick={() => move.mutate({ status: a.to, ...(a.to === "published" && url ? { publishedUrl: url } : {}) })}>{a.label}</Button>
              ))}
            </div>
            {item.status === "approved" && can("content:approve") && (
              <div className="mt-4 space-y-2 border-t border-line pt-3">
                <label htmlFor="sched" className="block text-sm text-ink-2">Schedule for (PKT)</label>
                <div className="flex gap-2">
                  <input id="sched" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-ink [color-scheme:dark]" />
                  <Button variant="secondary" disabled={!when || move.isPending} onClick={() => move.mutate({ status: "scheduled", scheduledFor: pktToIso(when) })}>Schedule</Button>
                </div>
              </div>
            )}
            {["approved", "scheduled"].includes(item.status) && can("content:approve") && (
              <div className="mt-3 space-y-1.5">
                <label htmlFor="puburl" className="block text-sm text-ink-2">Published link (optional, used when you mark as published)</label>
                <input id="puburl" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://facebook.com/…" className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink" />
              </div>
            )}
            {item.scheduledFor && <p className="mt-3 text-sm text-ink-2">Scheduled: {formatDateTime(item.scheduledFor)}</p>}
            {item.data.publishedUrl && <p className="mt-2 text-sm"><a className="text-accent hover:underline" href={item.data.publishedUrl} target="_blank" rel="noreferrer">View published post</a></p>}
            <p className="mt-3 text-xs text-ink-3">Automatic publishing to Facebook/Instagram/YouTube comes with integrations (Milestone 11) and will always need approval. For now, post it yourself and mark it as published.</p>
            {msg && <p role="status" className="mt-2 text-sm text-ink-2">{msg}</p>}
          </Card>

          {item.sourceTaskId && <Link to={`/tasks/${item.sourceTaskId}`} className="block text-sm text-accent hover:underline">See the task and agent reasoning →</Link>}
          {!!item.data.history?.length && (
            <Card title="History">
              <ul className="space-y-1 text-xs text-ink-2">{item.data.history.map((h, i) => <li key={i}>{formatDateTime(h.at)}: {h.from} → {h.to}{h.note ? ` · "${h.note}"` : ""}</li>)}</ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
