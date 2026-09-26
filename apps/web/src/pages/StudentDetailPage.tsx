import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, X } from "lucide-react";
import { Button, Card, Field, StatusBadge } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime, formatMoney } from "../lib/format.js";
import type { Payment, Progress } from "../lib/edu-types.js";
import { PageHeader } from "../components/Layout.js";
import { formValues, Select } from "../components/Form.js";

interface StudentDetail {
  contact: { name: string | null; phone: string | null; email: string | null };
  lead: { id: string; status: string } | null;
  enrollments: { id: string; batchId: string; batchName: string; courseTitle: string; progress?: Progress; payments: Payment[] }[];
  certificateRules: { version: string };
}

export function StudentDetailPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["student", id], queryFn: ({ signal }) => api<StudentDetail>(`/api/students/${id}`, { signal }) });
  const act = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) => api(url, { method: "POST", body: body ?? {} }),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ["student", id] }); void qc.invalidateQueries({ queryKey: ["students"] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
  });
  const pay = (enrollmentId: string) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    act.mutate({ url: `/api/enrollments/${enrollmentId}/payments`, body: formValues(form) }, { onSuccess: () => form.reset() });
  };

  if (!q.data) return <p className="text-sm text-ink-3">{q.isError ? (q.error as Error).message : "Loading…"}</p>;
  const { contact, lead, enrollments } = q.data;

  return (
    <>
      <Link to="/students" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Students</Link>
      <PageHeader
        title={contact.name ?? contact.phone ?? "Student"}
        description={`${contact.phone ?? ""}${contact.email ? ` · ${contact.email}` : ""}`}
        action={lead && <Link to={`/leads/${lead.id}`} className="text-sm text-accent hover:underline">Sales lead ({lead.status})</Link>}
      />
      {error && <p role="alert" className="mb-3 text-sm text-status-critical">{error}</p>}

      <div className="space-y-4">
        {enrollments.map((e) => {
          const p = e.progress;
          return (
            <Card key={e.id} title={<Link to={`/batches/${e.batchId}`} className="text-base text-ink hover:underline">{e.courseTitle} · {e.batchName}</Link>} action={p && <StatusBadge status={p.status} />}>
              {p && (
                <div className="grid gap-4 lg:grid-cols-3">
                  <div>
                    <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Progress</h3>
                    <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                      <dt className="text-ink-3">Attendance</dt><dd className="tabular text-ink">{p.classesAttended}/{p.classesHeld} ({p.attendancePct}%)</dd>
                      <dt className="text-ink-3">Assignments</dt><dd className="tabular text-ink">{p.assignmentsSubmitted}/{p.assignmentsTotal}</dd>
                      <dt className="text-ink-3">Fee</dt><dd className="tabular text-ink">{p.priceMinor != null ? formatMoney(p.priceMinor) : "—"}</dd>
                      <dt className="text-ink-3">Verified paid</dt><dd className="tabular text-ink">{formatMoney(p.paidVerifiedMinor)}</dd>
                      <dt className="text-ink-3">Balance</dt><dd className={`tabular ${p.balanceMinor ? "text-status-serious" : "text-ink"}`}>{p.balanceMinor != null ? formatMoney(p.balanceMinor) : "—"}</dd>
                    </dl>
                  </div>

                  <div>
                    <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Payments</h3>
                    <ul className="space-y-1.5 text-sm">
                      {e.payments.map((pm) => (
                        <li key={pm.id} className="flex items-center justify-between gap-2">
                          <span className="text-ink">{formatMoney(pm.amountMinor)} <span className="text-xs text-ink-3">{pm.method}{pm.reference ? ` · ${pm.reference}` : ""}{pm.paidAt ? ` · ${formatDateTime(pm.paidAt)}` : ""}</span></span>
                          {pm.status === "pending" && can("payments:verify") ? (
                            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => act.mutate({ url: `/api/payments/${pm.id}/verify` })}>Verify</Button>
                          ) : (
                            <StatusBadge status={pm.status} />
                          )}
                        </li>
                      ))}
                      {!e.payments.length && <li className="text-ink-3">No payments recorded.</li>}
                    </ul>
                    {can("payments:write") && (
                      <form onSubmit={pay(e.id)} className="mt-3 grid grid-cols-2 gap-2">
                        <Field label="Amount (PKR)" name="amountPkr" type="number" min={1} required />
                        <Select label="Method" name="method" defaultValue="jazzcash">
                          <option value="jazzcash">JazzCash</option><option value="easypaisa">EasyPaisa</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option>
                        </Select>
                        <Field label="Reference / TID" name="reference" className="col-span-2" />
                        <Button type="submit" variant="secondary" className="col-span-2" disabled={act.isPending}>Record payment (pending until verified)</Button>
                      </form>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Certificate ({q.data.certificateRules.version})</h3>
                    <ul className="space-y-1.5 text-sm">
                      {p.certificate.checks.map((c) => (
                        <li key={c.rule} className="flex items-start gap-2">
                          {c.ok ? <Check className="mt-0.5 size-4 shrink-0 text-status-good" aria-label="passed" /> : <X className="mt-0.5 size-4 shrink-0 text-status-serious" aria-label="not met" />}
                          <span><span className="text-ink">{c.rule}</span><span className="block text-xs text-ink-3">{c.detail}</span></span>
                        </li>
                      ))}
                    </ul>
                    {p.certificateStatus === "issued" ? (
                      <StatusBadge status="issued" className="mt-3" />
                    ) : (
                      can("certificates:issue") && (
                        <Button className="mt-3" disabled={!p.certificate.eligible || act.isPending} onClick={() => confirm("Issue the certificate for this enrolment?") && act.mutate({ url: `/api/enrollments/${e.id}/certificate` })}>
                          Issue certificate
                        </Button>
                      )
                    )}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
