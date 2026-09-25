import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Plus, Search } from "lucide-react";
import { Button, Card, EmptyState, Field, StatusBadge } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime } from "../lib/format.js";
import { PageHeader } from "../components/Layout.js";
import { Select } from "../components/Form.js";

const CATEGORIES = ["course", "pricing", "schedule", "policy", "faq", "teaching", "business", "marketing", "brand"];
interface Doc { id: string; title: string; category: string; language: string; status: string; version: number; approvedAt: string | null; updatedAt: string; preview: string; chunks: number; embedded: number }
interface Memory { id: string; kind: string; subject: string; content: string; createdAt: string }

function DocEditor({ doc, onDone }: { doc?: Doc & { body?: string }; onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const full = useQuery({ queryKey: ["knowledge-doc", doc?.id], queryFn: ({ signal }) => api<{ document: { body: string } }>(`/api/knowledge/${doc!.id}`, { signal }), enabled: !!doc });
  const m = useMutation({
    mutationFn: (body: unknown) => api(doc ? `/api/knowledge/${doc.id}` : "/api/knowledge", { method: doc ? "PATCH" : "POST", body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["knowledge"] }); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    m.mutate({ title: f.get("title"), category: f.get("category"), language: f.get("language"), body: f.get("body") });
  }
  if (doc && !full.data) return <p className="text-sm text-ink-3">Loading…</p>;
  return (
    <Card title={doc ? `Edit: ${doc.title}` : "New knowledge document"} className="mb-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <Field label="Title" name="title" required defaultValue={doc?.title} />
        <Select label="Category" name="category" defaultValue={doc?.category ?? "faq"}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <Select label="Language" name="language" defaultValue={doc?.language ?? "en"}><option value="en">English</option><option value="ur-roman">Roman Urdu</option><option value="ur">Urdu</option></Select>
        <div className="space-y-1.5 sm:col-span-3">
          <label htmlFor="kb-body" className="block text-sm text-ink-2">Content</label>
          <textarea id="kb-body" name="body" required rows={10} defaultValue={full.data?.document.body} className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink" />
        </div>
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" disabled={m.isPending}>{doc ? "Save (returns to draft if approved)" : "Save as draft"}</Button>
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
          {error && <span role="alert" className="text-sm text-status-critical">{error}</span>}
        </div>
      </form>
    </Card>
  );
}

export function KnowledgePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Doc | "new" | null>(null);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const docs = useQuery({ queryKey: ["knowledge", status], queryFn: ({ signal }) => api<{ documents: Doc[]; search: { semantic: boolean; model: string | null } }>(`/api/knowledge${status ? `?status=${status}` : ""}`, { signal }) });
  const memory = useQuery({ queryKey: ["memory"], queryFn: ({ signal }) => api<{ items: Memory[] }>("/api/memory", { signal }) });
  const search = useMutation({ mutationFn: (q: string) => api<{ results: { title: string; category: string; content: string; match: string[] }[] }>(`/api/knowledge/search?q=${encodeURIComponent(q)}`) });
  const act = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) => api<{ warning?: string; chunks?: number }>(url, { method: "POST", body: body ?? {} }),
    onSuccess: (r) => { setMsg(r?.warning ?? null); void qc.invalidateQueries({ queryKey: ["knowledge"] }); void qc.invalidateQueries({ queryKey: ["memory"] }); },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : "Failed"),
  });

  return (
    <>
      <PageHeader
        title="Knowledge"
        description="Approved facts agents may use: policies, FAQs, teaching material, brand. Drafts are invisible to agents until approved."
        action={can("knowledge:write") && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> New document</Button>}
      />
      {editing && <DocEditor doc={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
      {msg && <p role="status" className="mb-3 text-sm text-status-warning">{msg}</p>}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm text-ink">
              <option value="">All</option><option value="draft">Drafts</option><option value="approved">Approved</option><option value="archived">Archived</option>
            </select>
            <span className="text-xs text-ink-3">Search mode: {docs.data?.search.semantic ? `semantic + full-text (${docs.data.search.model})` : "full-text (add VOYAGE_API_KEY for semantic search)"}</span>
            {can("knowledge:approve") && docs.data?.search.semantic && <Button variant="ghost" className="ml-auto px-2 py-1 text-xs" onClick={() => act.mutate({ url: "/api/knowledge/reindex" })}>Re-index all</Button>}
          </div>
          {docs.data?.documents.length ? (
            docs.data.documents.map((d) => (
              <Card key={d.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{d.title}</span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">{d.category}</span>
                  <StatusBadge status={d.status} className="ml-auto" />
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-ink-2">{d.preview}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <span>v{d.version} · updated {formatDateTime(d.updatedAt)}</span>
                  {d.status === "approved" && <span>· {d.chunks} chunks{d.embedded ? `, ${d.embedded} embedded` : ""}</span>}
                  <span className="ml-auto flex gap-1">
                    {can("knowledge:write") && d.status !== "archived" && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(d)}>Edit</Button>}
                    {can("knowledge:approve") && d.status === "draft" && <Button className="px-2 py-1 text-xs" disabled={act.isPending} onClick={() => act.mutate({ url: `/api/knowledge/${d.id}/approve` })}>Approve</Button>}
                    {can("knowledge:approve") && d.status === "approved" && <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => act.mutate({ url: `/api/knowledge/${d.id}/archive` })}>Archive</Button>}
                  </span>
                </div>
              </Card>
            ))
          ) : (
            <Card>
              <EmptyState icon={<Brain className="size-6" />} title={docs.isLoading ? "Loading…" : "No knowledge yet"}>
                Add your refund, recording, certificate and catch-up policies and your FAQs. Agents will quote them only after you approve them.
              </EmptyState>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Test what agents will find">
            <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(query.trim()); }} className="flex gap-2">
              <input aria-label="Knowledge search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. refund kab milta hai" className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink" />
              <Button type="submit" variant="secondary" aria-label="Search"><Search className="size-4" /></Button>
            </form>
            {search.data && (
              <ul className="mt-3 space-y-2 text-sm">
                {search.data.results.length ? search.data.results.map((r, i) => (
                  <li key={i} className="rounded-lg border border-line p-2">
                    <div className="flex justify-between gap-2"><span className="font-medium text-ink">{r.title}</span><span className="text-[11px] text-ink-3">{r.match.join(" + ")}</span></div>
                    <p className="mt-1 line-clamp-3 text-xs text-ink-2">{r.content}</p>
                  </li>
                )) : <li className="text-ink-3">Nothing approved matches, so agents will say they don't know.</li>}
              </ul>
            )}
          </Card>

          <Card title={`Proposed memories (${memory.data?.items.length ?? 0})`}>
            {memory.data?.items.length ? (
              <ul className="space-y-2 text-sm">
                {memory.data.items.map((m) => (
                  <li key={m.id} className="rounded-lg border border-line p-2">
                    <div className="text-xs text-ink-3">{m.kind} · {m.subject}</div>
                    <p className="text-ink">{m.content}</p>
                    {can("knowledge:approve") && (
                      <div className="mt-1 flex gap-1">
                        <Button className="px-2 py-1 text-xs" onClick={() => act.mutate({ url: `/api/memory/${m.id}/decide`, body: { decision: "approved" } })}>Keep</Button>
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => act.mutate({ url: `/api/memory/${m.id}/decide`, body: { decision: "rejected" } })}>Discard</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Agents propose lasting preferences and decisions here. Nothing becomes trusted memory without your approval.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
