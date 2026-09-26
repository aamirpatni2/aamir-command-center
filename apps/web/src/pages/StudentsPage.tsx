import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap } from "lucide-react";
import { Card, EmptyState, StatusBadge } from "@acc/ui";
import { api } from "../lib/api.js";
import { formatMoney } from "../lib/format.js";
import type { Course, Progress } from "../lib/edu-types.js";
import { PageHeader } from "../components/Layout.js";

interface Row { enrollmentId: string; studentId: string; name: string | null; phone: string | null; batchId: string; batchName: string; courseTitle: string; progress?: Progress }

export function StudentsPage() {
  const [params, setParams] = useSearchParams();
  const batchId = params.get("batchId") ?? "";
  const qText = params.get("q") ?? "";
  const courses = useQuery({ queryKey: ["courses"], queryFn: ({ signal }) => api<{ courses: Course[] }>("/api/courses", { signal }) });
  const qs = new URLSearchParams(Object.entries({ batchId, q: qText }).filter(([, v]) => v)).toString();
  const list = useQuery({ queryKey: ["students", qs], queryFn: ({ signal }) => api<{ students: Row[] }>(`/api/students?${qs}`, { signal }) });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };

  return (
    <>
      <PageHeader title="Students" description="Enrolments with live attendance, balance and certificate eligibility. Enrol students from a batch page." />
      <div className="mb-3 flex flex-wrap gap-2">
        <input type="search" aria-label="Search students" placeholder="Search name or phone" defaultValue={qText} onChange={(e) => set("q", e.target.value)} className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink placeholder:text-ink-3" />
        <select aria-label="Batch" value={batchId} onChange={(e) => set("batchId", e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm text-ink">
          <option value="">All batches</option>
          {courses.data?.courses.flatMap((c) => c.batches.map((b) => <option key={b.id} value={b.id}>{c.title} · {b.name}</option>))}
        </select>
      </div>
      <Card className="p-0">
        {list.data?.students.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-3"><tr>{["Student", "Course · batch", "Enrolment", "Attendance", "Assignments", "Balance", "Certificate"].map((h) => <th key={h} className="px-4 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {list.data.students.map((s) => (
                  <tr key={s.enrollmentId} className="hover:bg-surface-2">
                    <td className="px-4 py-2"><Link to={`/students/${s.studentId}`} className="block"><span className="text-ink">{s.name ?? "Unknown"}</span><span className="tabular block text-xs text-ink-3">{s.phone}</span></Link></td>
                    <td className="px-4 py-2 text-ink-2"><Link to={`/batches/${s.batchId}`} className="hover:underline">{s.courseTitle} · {s.batchName}</Link></td>
                    <td className="px-4 py-2">{s.progress && <StatusBadge status={s.progress.status} />}</td>
                    <td className={`tabular px-4 py-2 ${s.progress && s.progress.classesHeld > 0 && s.progress.attendancePct < 75 ? "text-status-serious" : "text-ink-2"}`}>{s.progress ? `${s.progress.attendancePct}% (${s.progress.classesAttended}/${s.progress.classesHeld})` : "—"}</td>
                    <td className="tabular px-4 py-2 text-ink-2">{s.progress ? `${s.progress.assignmentsSubmitted}/${s.progress.assignmentsTotal}` : "—"}</td>
                    <td className="tabular px-4 py-2 text-ink-2">{s.progress?.balanceMinor != null ? formatMoney(s.progress.balanceMinor) : "—"}</td>
                    <td className="px-4 py-2">{s.progress && <StatusBadge status={s.progress.certificateStatus === "issued" ? "issued" : s.progress.certificate.eligible ? "eligible" : "not_eligible"} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<GraduationCap className="size-6" />} title={list.isLoading ? "Loading…" : "No students yet"}>Create a course and batch, then enrol students from the batch page.</EmptyState>
        )}
      </Card>
    </>
  );
}
