import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, StatusBadge, cn } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime, formatMoney } from "../lib/format.js";
import type { ClassRow, Progress } from "../lib/edu-types.js";
import { PageHeader } from "../components/Layout.js";
import { formValues, pktToIso } from "../components/Form.js";

interface BatchDetail {
  batch: { id: string; name: string; status: string; startsOn: string | null; endsOn: string | null; capacity: number | null };
  course: { id: string; title: string };
  roster: { enrollmentId: string; studentId: string; status: string; name: string | null; phone: string | null; progress?: Progress }[];
  classes: ClassRow[];
  assignments: { id: string; title: string; dueAt: string | null; maxScore: number | null }[];
}
const MARKS = ["present", "late", "absent"] as const;

function Attendance({ cls, roster, onSaved }: { cls: ClassRow; roster: BatchDetail["roster"]; onSaved: () => void }) {
  const [marks, setMarks] = useState<Record<string, (typeof MARKS)[number]>>(cls.attendance);
  const save = useMutation({ mutationFn: () => api(`/api/classes/${cls.id}/attendance`, { method: "PUT", body: { attendance: marks } }), onSuccess: onSaved });
  return (
    <div className="mt-2 space-y-1.5">
      {roster.map((r) => (
        <div key={r.enrollmentId} className="flex items-center justify-between gap-2 text-sm">
          <span className="text-ink-2">{r.name ?? r.phone}</span>
          <div className="flex gap-1" role="group" aria-label={`Attendance for ${r.name ?? r.phone}`}>
            {MARKS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={marks[r.enrollmentId] === m}
                onClick={() => setMarks({ ...marks, [r.enrollmentId]: m })}
                className={cn("rounded-md border px-2 py-0.5 text-xs capitalize", marks[r.enrollmentId] === m ? "border-accent bg-accent/15 text-ink" : "border-line text-ink-3 hover:text-ink")}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      ))}
      <Button variant="secondary" className="mt-2" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save attendance"}</Button>
    </div>
  );
}

export function BatchPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["batch", id], queryFn: ({ signal }) => api<BatchDetail>(`/api/batches/${id}`, { signal }) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["batch", id] });
  const post = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api(url, { method: "POST", body }),
    onSuccess: () => { setError(null); refresh(); void qc.invalidateQueries({ queryKey: ["courses"] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
  });
  const submit = (url: string, transform: (v: Record<string, unknown>) => unknown) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    post.mutate({ url, body: transform(formValues(form)) }, { onSuccess: () => form.reset() });
  };

  if (!q.data) return <p className="text-sm text-ink-3">{q.isError ? (q.error as Error).message : "Loading…"}</p>;
  const { batch, course, roster, classes, assignments } = q.data;
  const write = can("students:write");

  return (
    <>
      <Link to="/courses" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Courses</Link>
      <PageHeader title={`${course.title} · ${batch.name}`} description={`${batch.status} · ${batch.startsOn ?? "start date not set"}${batch.endsOn ? ` → ${batch.endsOn}` : ""} · ${roster.length}${batch.capacity ? `/${batch.capacity}` : ""} enrolled`} />
      {error && <p role="alert" className="mb-3 text-sm text-status-critical">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Students">
          {write && (
            <form onSubmit={submit("/api/enrollments", (v) => ({ ...v, batchId: id }))} className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Phone" name="phone" required inputMode="tel" />
              <Field label="Name" name="name" />
              <Button type="submit" disabled={post.isPending}><Plus className="size-4" aria-hidden /> Enrol</Button>
            </form>
          )}
          {roster.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-ink-3"><tr>{["Student", "Status", "Attendance", "Balance", "Certificate"].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {roster.map((r) => (
                    <tr key={r.enrollmentId}>
                      <td className="py-2 pr-3"><Link to={`/students/${r.studentId}`} className="text-accent hover:underline">{r.name ?? r.phone}</Link></td>
                      <td className="py-2 pr-3"><StatusBadge status={r.status} /></td>
                      <td className="tabular py-2 pr-3 text-ink-2">{r.progress ? `${r.progress.classesAttended}/${r.progress.classesHeld} (${r.progress.attendancePct}%)` : "—"}</td>
                      <td className="tabular py-2 pr-3 text-ink-2">{r.progress?.balanceMinor != null ? formatMoney(r.progress.balanceMinor) : "—"}</td>
                      <td className="py-2 pr-3">{r.progress && <StatusBadge status={r.progress.certificateStatus === "issued" ? "issued" : r.progress.certificate.eligible ? "eligible" : "not_eligible"} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No students enrolled yet" />
          )}
        </Card>

        <Card title="Classes">
          {write && (
            <form onSubmit={submit(`/api/batches/${id}/classes`, (v) => ({ ...v, startsAt: pktToIso(String(v.startsAt)) }))} className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Title" name="title" required />
              <Field label="Starts (PKT)" name="startsAt" type="datetime-local" required className="[&_input]:[color-scheme:dark]" />
              <Button type="submit" disabled={post.isPending}><Plus className="size-4" aria-hidden /> Add</Button>
            </form>
          )}
          {classes.length ? (
            <ul className="divide-y divide-line">
              {classes.map((c) => {
                const held = new Date(c.startsAt) <= new Date();
                return (
                  <li key={c.id} className="py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-ink">{c.title}</span>
                      <span className="flex items-center gap-2 text-xs text-ink-3">
                        {formatDateTime(c.startsAt)}
                        {c.recordingStatus === "available" && c.recordingUrl && <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">recording</a>}
                        {held && write && (
                          <button onClick={() => setOpen(open === c.id ? null : c.id)} className="text-accent hover:underline">
                            {open === c.id ? "close" : `attendance (${Object.keys(c.attendance).length}/${roster.length})`}
                          </button>
                        )}
                      </span>
                    </div>
                    {open === c.id && <Attendance cls={c} roster={roster} onSaved={() => { setOpen(null); refresh(); }} />}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No classes scheduled" />
          )}
        </Card>

        <Card title="Assignments" className="xl:col-span-2">
          {write && (
            <form onSubmit={submit(`/api/batches/${id}/assignments`, (v) => ({ ...v, ...(v.dueAt ? { dueAt: pktToIso(String(v.dueAt)) } : {}) }))} className="mb-3 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
              <Field label="Title" name="title" required />
              <Field label="Due (PKT)" name="dueAt" type="datetime-local" className="[&_input]:[color-scheme:dark]" />
              <Field label="Max score" name="maxScore" type="number" min={1} />
              <Button type="submit" disabled={post.isPending}><Plus className="size-4" aria-hidden /> Add</Button>
            </form>
          )}
          {assignments.length ? (
            <ul className="divide-y divide-line text-sm">
              {assignments.map((a) => (
                <li key={a.id} className="flex justify-between py-2"><span className="text-ink">{a.title}</span><span className="text-xs text-ink-3">{a.dueAt ? `due ${formatDateTime(a.dueAt)}` : "no due date"}{a.maxScore ? ` · /${a.maxScore}` : ""}</span></li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No assignments yet" />
          )}
        </Card>
      </div>
    </>
  );
}
