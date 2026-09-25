import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, FlaskConical, User, Wrench } from "lucide-react";
import { Button, Card, StatusBadge } from "@acc/ui";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime, formatDuration, formatUsd } from "../lib/format.js";
import type { TaskDetail, TimelineMessage } from "../lib/types.js";
import { PageHeader } from "../components/Layout.js";

const OPEN = new Set(["QUEUED", "RUNNING", "WAITING_APPROVAL"]);

function useTaskEvents(id: string, active: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!active) return;
    const es = new EventSource(`/api/tasks/${id}/events`, { withCredentials: true });
    const refresh = () => void qc.invalidateQueries({ queryKey: ["task", id] });
    for (const type of ["task.status", "run.started", "run.step", "run.finished"]) es.addEventListener(type, refresh);
    es.onerror = () => es.close(); // falls back to polling below
    return () => es.close();
  }, [id, active, qc]);
}

function Step({ m }: { m: TimelineMessage }) {
  if (m.role === "system") return null;
  const c = m.content as { text?: string; toolCalls?: { name: string; input: unknown }[]; content?: string; outcome?: string; input?: unknown };
  const icon = m.role === "user" ? <User className="size-4" /> : m.role === "tool" ? <Wrench className="size-4" /> : <Bot className="size-4" />;
  const label = m.role === "tool" ? `Tool · ${m.toolName}` : m.role === "user" ? "Request" : "Agent";
  return (
    <li className="flex gap-3">
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2" aria-hidden>{icon}</div>
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span className="font-medium text-ink-2">{label}</span>
          {m.toolRisk && <StatusBadge status={m.toolRisk} />}
          {m.isError && <StatusBadge status="FAILED" label="Error" />}
          {m.latencyMs != null && <span>{formatDuration(m.latencyMs)}</span>}
        </div>
        {m.role === "tool" ? (
          <details className="mt-1 text-sm">
            <summary className="cursor-pointer text-ink-2">
              {c.outcome === "approval_required" ? "Submitted for approval" : c.outcome === "ok" ? "Returned data" : "Returned an error"}
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-bg p-3 text-xs whitespace-pre-wrap text-ink-2">{prettyJson(c.content)}</pre>
          </details>
        ) : (
          <>
            {c.text && <p className="mt-1 text-sm whitespace-pre-wrap text-ink">{c.text}</p>}
            {c.toolCalls?.map((t, i) => (
              <p key={i} className="mt-1 font-mono text-xs text-accent">→ {t.name}({JSON.stringify(t.input).slice(0, 140)})</p>
            ))}
          </>
        )}
      </div>
    </li>
  );
}

function prettyJson(s: unknown) {
  if (typeof s !== "string") return JSON.stringify(s, null, 2);
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export function TaskDetailPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["task", id],
    queryFn: ({ signal }) => api<TaskDetail>(`/api/tasks/${id}`, { signal }),
    refetchInterval: (query) => (query.state.data && OPEN.has(query.state.data.task.status) ? 4000 : false),
  });
  const open = !!q.data && ["QUEUED", "RUNNING"].includes(q.data.task.status);
  useTaskEvents(id, open);

  const cancel = useMutation({
    mutationFn: () => api(`/api/tasks/${id}/cancel`, { method: "POST" }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["task", id] }),
  });

  if (q.isError) return <PageHeader title="Task not found" description={(q.error as Error).message} />;
  if (!q.data) return <p className="text-sm text-ink-3">Loading…</p>;
  const { task, runs, messages, approvals } = q.data;
  const mock = task.result?.mock || runs.some((r) => r.modelProvider === "mock");

  return (
    <>
      <Link to="/tasks" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Tasks
      </Link>
      <PageHeader
        title={task.title}
        description={`Created ${formatDateTime(task.createdAt)}${task.requestedBy ? ` by ${task.requestedBy}` : ""}`}
        action={
          <div className="flex items-center gap-2">
            {mock && <StatusBadge status="external" label="Mock model" />}
            <StatusBadge status={task.status} />
            {can("tasks:cancel") && OPEN.has(task.status) && (
              <Button variant="secondary" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel</Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {task.status === "COMPLETED" || task.status === "WAITING_APPROVAL" ? (
            <Card title="Result">
              <p className="text-sm whitespace-pre-wrap text-ink">{task.result?.text || "(no text)"}</p>
            </Card>
          ) : task.error ? (
            <Card title="Error">
              <p className="text-sm text-status-critical">{task.error}</p>
            </Card>
          ) : null}

          {mock && (
            <p className="flex items-start gap-2 text-xs text-ink-3">
              <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Produced by the mock model. Tools, data and logs are real; the text is simulated.
            </p>
          )}

          <Card title="Timeline">
            {messages.length ? (
              <ol>{messages.map((m) => <Step key={`${m.runId}-${m.seq}`} m={m} />)}</ol>
            ) : (
              <p className="text-sm text-ink-3">{task.status === "QUEUED" ? "Waiting for the worker to pick this up…" : "No steps recorded."}</p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Request">
            <p className="text-sm whitespace-pre-wrap text-ink-2">{task.input}</p>
          </Card>
          {approvals.length > 0 && (
            <Card title="Waiting for approval">
              <ul className="space-y-2 text-sm">
                {approvals.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span className="text-ink">{a.title}</span>
                    <StatusBadge status={a.risk} />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-3">Approve or reject these in the Approval Center (Milestone 9).</p>
            </Card>
          )}
          {runs.map((r) => (
            <Card key={r.id} title={<span className="capitalize">{r.agentId} agent run</span>} action={<StatusBadge status={r.status} />}>
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-ink-3">Model</dt><dd className="text-ink">{r.model ?? "—"}</dd>
                <dt className="text-ink-3">Duration</dt><dd className="tabular text-ink">{formatDuration(r.latencyMs)}</dd>
                <dt className="text-ink-3">Tool calls</dt><dd className="tabular text-ink">{r.toolCallCount}</dd>
                <dt className="text-ink-3">Tokens in/out</dt><dd className="tabular text-ink">{r.inputTokens ?? 0} / {r.outputTokens ?? 0}</dd>
                <dt className="text-ink-3">Est. cost</dt><dd className="tabular text-ink">{formatUsd(r.costMicroUsd)}</dd>
              </dl>
              {r.errorMessage && <p className="mt-2 text-xs text-status-critical">{r.errorCode}: {r.errorMessage}</p>}
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
