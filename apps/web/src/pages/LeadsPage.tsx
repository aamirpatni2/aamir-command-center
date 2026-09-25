import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { Button, Card, EmptyState, Field, StatusBadge } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime, timeAgo } from "../lib/format.js";
import { LEAD_STATUSES, type LeadRow } from "../lib/crm-types.js";
import { PageHeader } from "../components/Layout.js";

const SOURCES = ["manual", "whatsapp", "facebook_ad", "instagram_ad", "referral", "website", "event"];
const select = "rounded-md border border-line bg-bg px-2 py-1.5 text-sm text-ink";

function AddLead({ onDone }: { onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: Record<string, string>) => api<{ lead: { id: string }; duplicate: boolean }>("/api/leads", { method: "POST", body }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["leads"] });
      onDone(r.lead.id);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== ""));
    setError(null);
    m.mutate(body);
  }
  return (
    <Card title="Add a lead" className="mb-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Phone (e.g. 0300 1234567)" name="phone" required inputMode="tel" />
        <Field label="Name" name="name" />
        <div className="space-y-1.5">
          <label htmlFor="lead-source" className="block text-sm text-ink-2">Source</label>
          <select id="lead-source" name="source" className={`${select} w-full py-2`} defaultValue="manual">
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <Field label="Notes" name="notes" />
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={m.isPending}>{m.isPending ? "Saving…" : "Save lead"}</Button>
          <span className="text-xs text-ink-3">If this number already has an open lead, you'll be taken to it. No duplicate is created.</span>
          {error && <span role="alert" className="text-sm text-status-critical">{error}</span>}
        </div>
      </form>
    </Card>
  );
}

export function LeadsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const filters = { q: params.get("q") ?? "", band: params.get("band") ?? "", status: params.get("status") ?? "", due: params.get("due") ?? "", sort: params.get("sort") ?? "score" };
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const leads = useQuery({
    queryKey: ["leads", qs],
    queryFn: ({ signal }) => api<{ leads: LeadRow[]; total: number }>(`/api/leads?limit=100&${qs}`, { signal }),
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader
        title="Leads"
        description="Everyone who has enquired, scored by documented rules. WhatsApp enquiries arrive here automatically."
        action={can("leads:write") && <Button variant={adding ? "secondary" : "primary"} onClick={() => setAdding((a) => !a)}><Plus className="size-4" aria-hidden /> {adding ? "Close" : "Add lead"}</Button>}
      />
      {adding && <AddLead onDone={(id) => navigate(`/leads/${id}`)} />}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search leads"
          placeholder="Search name, phone, email"
          defaultValue={filters.q}
          onChange={(e) => set("q", e.target.value)}
          className="min-w-52 flex-1 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink placeholder:text-ink-3 sm:flex-none"
        />
        <select aria-label="Band" value={filters.band} onChange={(e) => set("band", e.target.value)} className={select}>
          <option value="">All bands</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
        </select>
        <select aria-label="Status" value={filters.status} onChange={(e) => set("status", e.target.value)} className={select}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Sort" value={filters.sort} onChange={(e) => set("sort", e.target.value)} className={select}>
          <option value="score">Highest score</option><option value="followup">Next follow-up</option><option value="recent">Latest message</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          <input type="checkbox" checked={filters.due === "today"} onChange={(e) => set("due", e.target.checked ? "today" : "")} /> Follow-up due
        </label>
        <span className="ml-auto text-xs text-ink-3">{leads.data ? `${leads.data.total} lead${leads.data.total === 1 ? "" : "s"}` : ""}</span>
      </div>

      <Card className="p-0">
        {leads.data?.leads.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-3">
                <tr>{["Lead", "Band", "Score", "Status", "Source", "Last message", "Next follow-up"].map((h) => <th key={h} className="px-4 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {leads.data.leads.map((l) => (
                  <tr key={l.id} className="hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <Link to={`/leads/${l.id}`} className="block">
                        <span className="text-ink">{l.name ?? "Unknown"}</span>
                        <span className="tabular block text-xs text-ink-3">{l.phone}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2"><StatusBadge status={l.band} /></td>
                    <td className="tabular px-4 py-2 text-ink">{l.score}</td>
                    <td className="px-4 py-2 text-ink-2 capitalize">{l.status}</td>
                    <td className="px-4 py-2 text-ink-2">{l.source}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-ink-2">{l.lastInboundAt ? timeAgo(l.lastInboundAt) : "—"}</td>
                    <td className={`px-4 py-2 whitespace-nowrap ${l.nextFollowUpAt && new Date(l.nextFollowUpAt) < new Date() ? "text-status-serious" : "text-ink-2"}`}>
                      {l.nextFollowUpAt ? formatDateTime(l.nextFollowUpAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Users className="size-6" />} title={leads.isLoading ? "Loading…" : qs.replace("sort=score", "") ? "No leads match these filters" : "No leads yet"}>
            New WhatsApp enquiries become leads automatically. You can also add one by hand.
          </EmptyState>
        )}
      </Card>
    </>
  );
}
