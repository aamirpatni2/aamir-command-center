import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, PenSquare, Plus } from "lucide-react";
import { Button, Card, EmptyState, StatusBadge } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { timeAgo } from "../lib/format.js";
import { LANG_LABEL, TYPE_LABEL, type ContentRow } from "../lib/content-types.js";
import { PageHeader } from "../components/Layout.js";
import { Select } from "../components/Form.js";

const STATUSES = ["draft", "in_review", "approved", "scheduled", "published", "rejected"];

function QuickDraft({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: unknown) => api("/api/content", { method: "POST", body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["content"] }); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const type = String(f.get("type"));
    const text = String(f.get("text"));
    m.mutate({ type, language: f.get("language"), data: type === "hook" ? { text } : type === "caption" ? { text, hashtags: [] } : { text, hashtags: [] } });
  }
  return (
    <Card title="Quick draft" className="mb-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[10rem_10rem_1fr]">
        <Select label="Type" name="type" defaultValue="post"><option value="post">Post</option><option value="caption">Caption</option><option value="hook">Hook</option></Select>
        <Select label="Language" name="language" defaultValue="ur-roman"><option value="ur-roman">Roman Urdu</option><option value="ur">Urdu</option><option value="en">English</option></Select>
        <div className="space-y-1.5">
          <label htmlFor="qd-text" className="block text-sm text-ink-2">Text</label>
          <textarea id="qd-text" name="text" required rows={3} className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink" />
        </div>
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" disabled={m.isPending}>Save draft</Button>
          <span className="text-xs text-ink-3">For Reels, scripts, carousels and prompts, ask the Content Agent on the Tasks page.</span>
          {error && <span role="alert" className="text-sm text-status-critical">{error}</span>}
        </div>
      </form>
    </Card>
  );
}

export function ContentList({ title, description, types }: { title: string; description: string; types?: string[] }) {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const status = params.get("status") ?? "";
  const type = params.get("type") ?? (types ? types.join(",") : "");
  const q = params.get("q") ?? "";
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const qs = new URLSearchParams(Object.entries({ status, type, q }).filter(([, v]) => v)).toString();
  const list = useQuery({ queryKey: ["content", qs], queryFn: ({ signal }) => api<{ items: ContentRow[] }>(`/api/content?${qs}`, { signal }), refetchInterval: 15_000 });

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        action={!types && can("content:write") && <Button variant={adding ? "secondary" : "primary"} onClick={() => setAdding((a) => !a)}><Plus className="size-4" aria-hidden /> {adding ? "Close" : "Quick draft"}</Button>}
      />
      {adding && <QuickDraft onDone={() => setAdding(false)} />}
      <div className="mb-3 flex flex-wrap gap-2">
        <input type="search" aria-label="Search content" placeholder="Search" defaultValue={q} onChange={(e) => set("q", e.target.value)} className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink placeholder:text-ink-3" />
        {!types && (
          <select aria-label="Type" value={type} onChange={(e) => set("type", e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm text-ink">
            <option value="">All types</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        <select aria-label="Status" value={status} onChange={(e) => set("status", e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm text-ink">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>
      {list.data?.items.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.data.items.map((i) => (
            <Link key={i.id} to={`/content/${i.id}`} className="flex flex-col rounded-xl border border-line bg-surface p-4 hover:border-line-strong hover:bg-surface-2">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">{TYPE_LABEL[i.type] ?? i.type}</span>
                <span className="text-[11px] text-ink-3">{LANG_LABEL[i.language]}{i.platform ? ` · ${i.platform}` : ""}</span>
                <StatusBadge status={i.status} className="ml-auto" />
              </div>
              <div className="line-clamp-2 text-sm font-medium text-ink">{i.title}</div>
              <p className="mt-1 line-clamp-3 flex-1 text-xs whitespace-pre-line text-ink-2">{i.preview}</p>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-3">
                {i.checkCount > 0 && <span className="inline-flex items-center gap-1 text-status-warning"><AlertTriangle className="size-3" aria-hidden /> {i.checkCount} check{i.checkCount > 1 ? "s" : ""}</span>}
                <span className="ml-auto">{timeAgo(i.createdAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<PenSquare className="size-6" />} title={list.isLoading ? "Loading…" : "Nothing here yet"}>
            Ask the Orchestrator on the <Link to="/tasks" className="text-accent hover:underline">Tasks</Link> page, e.g. "3 Reel ideas about Claude for freelancers". The Content Agent saves drafts here for your review.
          </EmptyState>
        </Card>
      )}
    </>
  );
}

export const ContentPage = () => <ContentList title="Content" description="Everything the Content Agent (or you) drafted. Nothing is published without your approval." />;
export const ReelsPage = () => <ContentList title="Reels" description="Reel scripts with hook, beats, on-screen text and CTA." types={["reel"]} />;
export const CreativesPage = () => <ContentList title="Creatives" description="AI image and video prompts for thumbnails, posts and Reels." types={["image_prompt", "video_prompt"]} />;
