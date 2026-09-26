import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, StatusBadge } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatMoney } from "../lib/format.js";
import type { Course } from "../lib/edu-types.js";
import { PageHeader } from "../components/Layout.js";
import { formValues, Select } from "../components/Form.js";

function useCreate(url: string, onDone: () => void) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(url, { method: "POST", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courses"] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? `${e.message}${Array.isArray(e.details) ? `: ${(e.details as { message: string }[]).map((d) => d.message).join(", ")}` : ""}` : "Failed"),
  });
  return { m, error, submit: (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(null); m.mutate(formValues(e.currentTarget)); } };
}

function CourseForm({ onDone }: { onDone: () => void }) {
  const { m, error, submit } = useCreate("/api/courses", onDone);
  return (
    <Card title="New course" className="mb-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Title" name="title" required />
        <Field label="Slug (url name)" name="slug" required pattern="[a-z0-9-]+" placeholder="practical-ai" />
        <Field label="Standard price (PKR)" name="pricePkr" type="number" min={0} step={1} />
        <Field label="Duration (weeks)" name="durationWeeks" type="number" min={1} />
        <Select label="Language" name="language" defaultValue="ur"><option value="ur">Urdu</option><option value="ur-roman">Roman Urdu</option><option value="en">English</option></Select>
        <Select label="Status" name="status" defaultValue="draft"><option value="draft">Draft (hidden from agents)</option><option value="active">Active (agents may quote it)</option></Select>
        <Field label="Description" name="description" className="sm:col-span-2 lg:col-span-3" />
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
          <Button type="submit" disabled={m.isPending}>Create course</Button>
          {error && <span role="alert" className="text-sm text-status-critical">{error}</span>}
        </div>
      </form>
    </Card>
  );
}

function BatchForm({ courseId, onDone }: { courseId: string; onDone: () => void }) {
  const { m, error, submit } = useCreate(`/api/courses/${courseId}/batches`, onDone);
  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Batch name" name="name" required placeholder="Batch 3" />
      <Field label="Starts on" name="startsOn" type="date" className="[&_input]:[color-scheme:dark]" />
      <Field label="Ends on" name="endsOn" type="date" className="[&_input]:[color-scheme:dark]" />
      <Field label="Seats" name="capacity" type="number" min={1} />
      <Field label="Price (PKR, blank = course price)" name="pricePkr" type="number" min={0} />
      <Field label="Early-bird price (PKR)" name="earlyBirdPricePkr" type="number" min={0} />
      <Field label="Early-bird until" name="earlyBirdUntil" type="date" className="[&_input]:[color-scheme:dark]" />
      <Select label="Status" name="status" defaultValue="enrolling"><option value="planned">Planned</option><option value="enrolling">Enrolling</option><option value="running">Running</option></Select>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={m.isPending}>Add batch</Button>
        {error && <span role="alert" className="text-sm text-status-critical">{error}</span>}
      </div>
    </form>
  );
}

export function CoursesPage() {
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const [batchFor, setBatchFor] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["courses"], queryFn: ({ signal }) => api<{ courses: Course[] }>("/api/courses", { signal }) });

  return (
    <>
      <PageHeader
        title="Courses"
        description="The approved catalogue. Active courses and their batches are the only prices and dates agents are allowed to quote."
        action={can("courses:write") && <Button variant={adding ? "secondary" : "primary"} onClick={() => setAdding((a) => !a)}><Plus className="size-4" aria-hidden /> {adding ? "Close" : "New course"}</Button>}
      />
      {adding && <CourseForm onDone={() => setAdding(false)} />}
      {q.data?.courses.length ? (
        <div className="space-y-4">
          {q.data.courses.map((c) => (
            <Card
              key={c.id}
              title={<span className="text-base text-ink">{c.title}</span>}
              action={<span className="flex items-center gap-2">{c.status === "active" ? <StatusBadge status="active" /> : <StatusBadge status="draft" label={c.status} />}<span className="text-sm text-ink-2">{c.priceMinor != null ? formatMoney(c.priceMinor) : "no price"}</span></span>}
            >
              {c.description && <p className="mb-3 text-sm text-ink-2">{c.description}</p>}
              {c.batches.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-ink-3"><tr>{["Batch", "Status", "Dates", "Price today", "Enrolled"].map((h) => <th key={h} className="py-1.5 pr-4 font-medium">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-line">
                      {c.batches.map((b) => (
                        <tr key={b.id}>
                          <td className="py-2 pr-4"><Link to={`/batches/${b.id}`} className="text-accent hover:underline">{b.name}</Link></td>
                          <td className="py-2 pr-4 text-ink-2 capitalize">{b.status}</td>
                          <td className="py-2 pr-4 whitespace-nowrap text-ink-2">{b.startsOn ?? "—"}{b.endsOn ? ` → ${b.endsOn}` : ""}</td>
                          <td className="py-2 pr-4 whitespace-nowrap text-ink">
                            {b.currentPriceMinor != null ? formatMoney(b.currentPriceMinor) : "—"}
                            {b.earlyBirdActive && <span className="ml-1.5 text-xs text-status-warning">early-bird until {b.earlyBirdUntil}</span>}
                          </td>
                          <td className="tabular py-2 pr-4 text-ink-2">{b.enrolled}{b.capacity ? ` / ${b.capacity}` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-ink-3">No batches yet.</p>
              )}
              {can("courses:write") &&
                (batchFor === c.id ? (
                  <BatchForm courseId={c.id} onDone={() => setBatchFor(null)} />
                ) : (
                  <Button variant="ghost" className="mt-2" onClick={() => setBatchFor(c.id)}><Plus className="size-4" aria-hidden /> Add batch</Button>
                ))}
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<BookOpen className="size-6" />} title={q.isLoading ? "Loading…" : "No courses yet"}>
            Add your courses and batches here. Until a course is <strong>active</strong>, agents will say its price and dates are unknown instead of guessing.
          </EmptyState>
        </Card>
      )}
    </>
  );
}
