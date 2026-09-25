import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { Card, cn, EmptyState, StatusBadge, TONE_CLASS } from "@acc/ui";
import { AgentChip } from "../components/AgentChip.js";
import { agentMeta } from "../lib/agents.js";
import { api } from "../lib/api.js";
import { formatDuration, formatUsd, timeAgo } from "../lib/format.js";
import type { ActivityRun } from "../lib/types.js";
import { PageHeader } from "../components/Layout.js";
import { ModelBanner } from "./TasksPage.js";

interface AgentsInfo {
  agents: { id: string; description: string; limitations: string | null; tools: string[]; model: string; effort: string | null; maxSteps: number }[];
  model: { available: boolean; mock: boolean; reason?: string };
}

const STATUSES = ["", "QUEUED", "RUNNING", "WAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"];

export function AgentsPage() {
  const [status, setStatus] = useState("");
  const info = useQuery({ queryKey: ["agents"], queryFn: ({ signal }) => api<AgentsInfo>("/api/agents", { signal }) });
  const runs = useQuery({
    queryKey: ["agent-runs", status],
    queryFn: ({ signal }) => api<{ runs: ActivityRun[] }>(`/api/agent-runs?limit=100${status ? `&status=${status}` : ""}`, { signal }),
    refetchInterval: 5000,
  });

  return (
    <>
      <PageHeader title="Agents" description="Which agents exist, what they may use, and every run they've made." />
      <ModelBanner info={info.data} />

      <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {info.data?.agents.map((a) => (
          <Card key={a.id} interactive className="overflow-hidden" title={<AgentChip id={a.id} suffix="" className="font-display text-[15px]" />}>
            <div aria-hidden className={cn("pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent to-transparent", TONE_CLASS[agentMeta(a.id).tone].edge)} />
            <p className="text-sm text-ink-2">{a.description}</p>
            {a.limitations && <p className="mt-3 rounded-xl border border-status-warning/20 bg-status-warning/5 px-3 py-2 text-xs leading-relaxed text-status-warning">Limited for now: {a.limitations}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {a.tools.map((t) => <span key={t} className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-ink-2">{t}</span>)}
            </div>
            <p className="mt-3 text-xs text-ink-3">{a.model} · effort {a.effort ?? "default"} · max {a.maxSteps} steps</p>
          </Card>
        ))}
      </div>

      <Card
        title="Agent activity"
        className="p-0 [&>header]:px-4 [&>header]:pt-4"
        action={
          <label className="flex items-center gap-2 text-xs text-ink-3">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1 text-ink">
              {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
            </select>
          </label>
        }
      >
        {runs.data?.runs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-3">
                <tr>
                  {["Agent", "Task", "Status", "Started", "Duration", "Tools used", "Tokens", "Cost", "Result / error"].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.data.runs.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2 whitespace-nowrap text-ink">
                      <AgentChip id={r.agentId} suffix="" />
                      {r.mock && <span className="ml-1.5 rounded bg-status-warning/15 px-1 text-[10px] text-status-warning">MOCK</span>}
                    </td>
                    <td className="max-w-56 px-4 py-2"><Link to={`/tasks/${r.taskId}`} className="line-clamp-2 text-accent hover:underline">{r.taskTitle}</Link></td>
                    <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2 whitespace-nowrap text-ink-2">{r.startedAt ? timeAgo(r.startedAt) : "—"}</td>
                    <td className="tabular px-4 py-2 whitespace-nowrap text-ink-2">{formatDuration(r.latencyMs)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-2">{r.toolsUsed.length ? r.toolsUsed.join(", ") : "—"}</td>
                    <td className="tabular px-4 py-2 whitespace-nowrap text-ink-2">{(r.inputTokens ?? 0) + (r.outputTokens ?? 0)}</td>
                    <td className="tabular px-4 py-2 text-ink-2">{formatUsd(r.costMicroUsd)}</td>
                    <td className="max-w-72 px-4 py-2 text-xs">
                      {r.errorMessage ? <span className="text-status-critical">{r.errorCode}: {r.errorMessage}</span> : <span className="line-clamp-2 text-ink-2">{r.resultText ?? "—"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Bot className="size-6" />} title={runs.isLoading ? "Loading…" : "No runs yet"}>
            Start a task from the Tasks page and its agent runs will appear here.
          </EmptyState>
        )}
      </Card>
    </>
  );
}
