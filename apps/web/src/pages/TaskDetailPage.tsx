import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Bot, FlaskConical, User, Wrench } from "lucide-react";
import { Button, Card, StatusBadge } from "@acc/ui";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime, formatDuration, formatUsd } from "../lib/format.js";
import type { TaskDetail, TimelineMessage } from "../lib/types.js";
import { PageHeader } from "../components/Layout.js";
import { AgentChip } from "../components/AgentChip.js";

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

const LANGUAGE: Record<string, string> = { ur: "Urdu", "ur-roman": "Roman Urdu", en: "English" };

function PlanView({ detail }: { detail: TaskDetail }) {
  const plan = detail.task.plan;
  if (!plan) return null;
  return (
    <Card title="Plan" action={<span className="text-xs text-ink-3">Output: {LANGUAGE[plan.language] ?? plan.language}</span>}>
      <p className="mb-3 text-sm text-ink-2">{plan.intent}</p>
      {plan.steps.length === 0 ? (
        <p className="text-sm text-ink-3">Answered directly. No specialist was needed.</p>
      ) : (
        <ol className="space-y-3">
          {plan.steps.map((s, i) => {
            const row = detail.steps.find((r) => r.position === i + 1);
            return (
              <li key={i} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-medium text-ink-2">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <AgentChip id={s.agent} className="text-sm font-medium" />
                    {row && <StatusBadge status={row.status} />}
                    {s.dependsOn.length > 0 && <span className="text-xs text-ink-3">uses step {s.dependsOn.join(", ")}</span>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-2">{s.instruction}</p>
                  <p className="mt-0.5 text-xs text-ink-3">Done when: {s.acceptance}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
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
              {!!task.result?.issues?.length && (
                <div className="mt-4 rounded-lg border border-status-warning/30 bg-status-warning/5 p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-status-warning">
                    <AlertTriangle className="size-3.5" aria-hidden /> Issues found in review
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-2">{task.result.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              )}
              {!!task.result?.nextSteps?.length && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-ink-3">Next steps</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-2">{task.result.nextSteps.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              )}
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

          <PlanView detail={q.data} />

          <Card title="Timeline">
            {messages.length ? (
              <div className="space-y-4">
                {runs.map((r) => {
                  const own = messages.filter((m) => m.runId === r.id);
                  if (!own.length) return null;
                  const step = q.data.steps.find((s) => s.id === r.stepId);
                  const label = step ? `Step ${step.position} · ${r.agentId} agent` : r.parentRunId ? "Review · orchestrator" : "Planning · orchestrator";
                  return (
                    <section key={r.id}>
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">
                        {label} <StatusBadge status={r.status} />
                      </h3>
                      <ol>{own.map((m) => <Step key={`${m.runId}-${m.seq}`} m={m} />)}</ol>
                    </section>
                  );
                })}
              </div>
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
          {runs.length > 0 && (
            <Card title={`Agent runs (${runs.length})`}>
              <dl className="mb-3 grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-ink-3">Model</dt><dd className="text-ink">{[...new Set(runs.map((r) => r.model ?? "—"))].join(", ")}</dd>
                <dt className="text-ink-3">Total time</dt><dd className="tabular text-ink">{formatDuration(runs.reduce((a, r) => a + (r.latencyMs ?? 0), 0))}</dd>
                <dt className="text-ink-3">Tokens in/out</dt>
                <dd className="tabular text-ink">{runs.reduce((a, r) => a + (r.inputTokens ?? 0), 0)} / {runs.reduce((a, r) => a + (r.outputTokens ?? 0), 0)}</dd>
                <dt className="text-ink-3">Est. cost</dt><dd className="tabular text-ink">{formatUsd(runs.reduce((a, r) => a + (r.costMicroUsd ?? 0), 0))}</dd>
              </dl>
              <ul className="divide-y divide-line text-sm">
                {runs.map((r) => (
                  <li key={r.id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink capitalize">{r.agentId}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular text-xs text-ink-3">{formatDuration(r.latencyMs)} · {r.toolCallCount} tools</span>
                        <StatusBadge status={r.status} />
                      </span>
                    </div>
                    {r.errorMessage && <p className="mt-1 text-xs text-status-critical">{r.errorCode}: {r.errorMessage}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
