import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Card, cn } from "@acc/ui";
import { api } from "../lib/api.js";
import { TYPE_LABEL } from "../lib/content-types.js";
import { PageHeader } from "../components/Layout.js";

interface CalItem { id: string; type: string; platform: string | null; title: string | null; status: string; at: string }

const pktDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(iso));
const pktTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function CalendarPage() {
  const now = new Date();
  const [ym, setYm] = useState(() => pktDate(now.toISOString()).slice(0, 7));
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const shift = (d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    setYm(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const q = useQuery({ queryKey: ["calendar", ym], queryFn: ({ signal }) => api<{ items: CalItem[] }>(`/api/content/calendar?month=${ym}`, { signal }) });

  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) * 7 }, (_, i) => i - lead + 1);
  const today = pktDate(now.toISOString());
  const byDay = new Map<string, CalItem[]>();
  for (const it of q.data?.items ?? []) {
    const d = pktDate(it.at);
    byDay.set(d, [...(byDay.get(d) ?? []), it]);
  }
  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);

  return (
    <>
      <PageHeader
        title="Content calendar"
        description="Scheduled and published content in Pakistan time. Schedule approved items from their detail page."
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></Button>
            <span className="min-w-36 text-center text-sm font-medium text-ink">{label}</span>
            <Button variant="secondary" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="size-4" /></Button>
          </div>
        }
      />
      <Card className="overflow-x-auto p-0">
        <div className="grid min-w-[44rem] grid-cols-7 border-b border-line text-xs text-ink-3">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-2 py-2">{d}</div>)}
        </div>
        <div className="grid min-w-[44rem] grid-cols-7">
          {cells.map((day, i) => {
            const inMonth = day >= 1 && day <= daysInMonth;
            const key = `${ym}-${String(day).padStart(2, "0")}`;
            const items = inMonth ? byDay.get(key) ?? [] : [];
            return (
              <div key={i} className={cn("min-h-28 border-r border-b border-line p-1.5", !inMonth && "bg-bg/50", i % 7 === 6 && "border-r-0")}>
                {inMonth && <div className={cn("mb-1 text-xs", key === today ? "font-semibold text-accent" : "text-ink-3")}>{day}</div>}
                <ul className="space-y-1">
                  {items.map((it) => (
                    <li key={it.id}>
                      <Link to={`/content/${it.id}`} className={cn("block truncate rounded px-1.5 py-1 text-[11px]", it.status === "published" ? "bg-status-good/15 text-ink" : "bg-accent/15 text-ink")} title={it.title ?? ""}>
                        <span className="tabular text-ink-3">{pktTime(it.at)}</span> {TYPE_LABEL[it.type]}: {it.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>
      <p className="mt-2 text-xs text-ink-3">Blue = scheduled, green = published.</p>
    </>
  );
}
