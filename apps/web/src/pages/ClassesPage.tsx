import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { Card, EmptyState } from "@acc/ui";
import { api } from "../lib/api.js";
import { formatDateTime } from "../lib/format.js";
import type { ClassRow } from "../lib/edu-types.js";
import { PageHeader } from "../components/Layout.js";

export function ClassesPage() {
  const [upcoming, setUpcoming] = useState(true);
  const q = useQuery({
    queryKey: ["classes", upcoming],
    queryFn: ({ signal }) => api<{ classes: ClassRow[] }>(`/api/classes?upcoming=${upcoming}`, { signal }),
  });
  return (
    <>
      <PageHeader
        title="Classes"
        description="All batches' classes in Pakistan time. Schedule classes and mark attendance from each batch page."
        action={
          <div className="flex rounded-lg border border-line p-0.5 text-sm" role="group" aria-label="Which classes">
            {[true, false].map((u) => (
              <button key={String(u)} aria-pressed={upcoming === u} onClick={() => setUpcoming(u)} className={`rounded-md px-3 py-1 ${upcoming === u ? "bg-surface-2 text-ink" : "text-ink-3"}`}>{u ? "Upcoming" : "Past"}</button>
            ))}
          </div>
        }
      />
      <Card className="p-0">
        {q.data?.classes.length ? (
          <ul className="divide-y divide-line">
            {q.data.classes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <div className="text-ink">{c.title}</div>
                  <Link to={`/batches/${c.batchId}`} className="text-xs text-ink-3 hover:underline">{c.courseTitle} · {c.batchName}</Link>
                </div>
                <div className="flex items-center gap-3 text-xs text-ink-2">
                  <span className="tabular">{formatDateTime(c.startsAt)} · {c.durationMin} min</span>
                  {c.meetingUrl && upcoming && <a href={c.meetingUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">join link</a>}
                  {!upcoming && c.attendanceSummary && <span className="tabular">{c.attendanceSummary.present + c.attendanceSummary.late} attended · {c.attendanceSummary.absent} absent</span>}
                  {!upcoming && <span>{c.recordingStatus === "available" ? "recording ✓" : "no recording"}</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<CalendarDays className="size-6" />} title={q.isLoading ? "Loading…" : upcoming ? "No upcoming classes" : "No past classes"} />
        )}
      </Card>
    </>
  );
}
