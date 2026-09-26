import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { Button, Card, StatusBadge } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime, timeAgo } from "../lib/format.js";
import { LEAD_STATUSES, type LeadDetail } from "../lib/crm-types.js";
import { PageHeader } from "../components/Layout.js";

/** ISO → value for <input type="datetime-local"> in Pakistan time. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? `${v}:00+05:00` : null);

export function LeadDetailPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["lead", id], queryFn: ({ signal }) => api<LeadDetail>(`/api/leads/${id}`, { signal }) });
  const [form, setForm] = useState({ status: "", notes: "", nextFollowUpAt: "", profileFit: false });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) {
      const l = q.data.lead;
      setForm({ status: l.status, notes: l.notes ?? "", nextFollowUpAt: toLocalInput(l.nextFollowUpAt), profileFit: !!l.signals.profileFit });
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/api/leads/${id}`, {
        method: "PATCH",
        body: { status: form.status, notes: form.notes || null, nextFollowUpAt: fromLocalInput(form.nextFollowUpAt), profileFit: form.profileFit },
      }),
    onSuccess: () => {
      setMsg("Saved");
      void qc.invalidateQueries({ queryKey: ["lead", id] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : "Could not save"),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/leads/${id}`, { method: "DELETE" }),
    onSuccess: () => navigate("/leads"),
  });

  if (q.isError) return <PageHeader title="Lead not found" description={(q.error as Error).message} />;
  if (!q.data) return <p className="text-sm text-ink-3">Loading…</p>;
  const { lead, contact, conversations } = q.data;
  const editable = can("leads:write");

  return (
    <>
      <Link to="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Leads</Link>
      <PageHeader
        title={contact.name ?? contact.phone ?? "Lead"}
        description={`${contact.phone ?? ""}${contact.email ? ` · ${contact.email}` : ""} · source ${lead.source} · since ${formatDateTime(lead.createdAt)}`}
        action={
          conversations[0] && (
            <Link to={`/conversations/${conversations[0].id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">
              <MessagesSquare className="size-4" aria-hidden /> Open conversation
            </Link>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Score">
          <div className="flex items-end gap-3">
            <span className="text-5xl font-semibold tracking-tight text-ink">{lead.score}</span>
            <StatusBadge status={lead.band} className="mb-2" />
          </div>
          <ul className="mt-4 space-y-1.5 text-sm">
            {lead.scoreReasons.length ? (
              lead.scoreReasons.map((r) => (
                <li key={r.rule} className="flex justify-between gap-3">
                  <span className="text-ink-2">{r.rule}</span>
                  <span className={`tabular ${r.points < 0 ? "text-status-serious" : "text-ink"}`}>{r.points > 0 ? `+${r.points}` : r.points}</span>
                </li>
              ))
            ) : (
              <li className="text-ink-3">No scoring signals yet.</li>
            )}
          </ul>
          <p className="mt-4 text-xs text-ink-3">
            {lead.inboundMessageCount} message{lead.inboundMessageCount === 1 ? "" : "s"} · last {lead.lastInboundAt ? timeAgo(lead.lastInboundAt) : "never"}. Starter rules v1, pending approval.
          </p>
        </Card>

        <Card title="Pipeline" className="lg:col-span-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setMsg(null);
              save.mutate();
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="space-y-1.5">
              <label htmlFor="lead-status" className="block text-sm text-ink-2">Status</label>
              <select id="lead-status" disabled={!editable} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-ink capitalize">
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="lead-followup" className="block text-sm text-ink-2">Next follow-up (PKT)</label>
              <input id="lead-followup" type="datetime-local" disabled={!editable} value={form.nextFollowUpAt} onChange={(e) => setForm({ ...form, nextFollowUpAt: e.target.value })} className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-ink [color-scheme:dark]" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="lead-notes" className="block text-sm text-ink-2">Notes</label>
              <textarea id="lead-notes" rows={5} disabled={!editable} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink" />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2">
              <input type="checkbox" disabled={!editable} checked={form.profileFit} onChange={(e) => setForm({ ...form, profileFit: e.target.checked })} />
              Fits the target profile (student, freelancer, teacher, job-seeker, business owner)
            </label>
            {editable && (
              <div className="flex items-center gap-3 sm:col-span-2">
                <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
                {msg && <span className="text-sm text-ink-2" role="status">{msg}</span>}
                {can("leads:delete") && (
                  <Button type="button" variant="ghost" className="ml-auto text-status-critical" onClick={() => confirm("Delete this lead? It can be restored from the database.") && del.mutate()}>
                    Delete
                  </Button>
                )}
              </div>
            )}
          </form>
        </Card>
      </div>
    </>
  );
}
