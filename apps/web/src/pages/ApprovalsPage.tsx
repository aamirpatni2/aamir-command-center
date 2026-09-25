import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CheckSquare, Clock, Pencil, RotateCw, ShieldCheck, XCircle } from "lucide-react";
import { Button, Card, EmptyState, StatusBadge, cn } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime, timeAgo } from "../lib/format.js";
import type { Approval, ApprovalList, DecisionResponse } from "../lib/approval-types.js";
import { PageHeader } from "../components/Layout.js";

const WINDOW_MS = 24 * 3600_000;
const MESSAGE_TOOLS = new Set(["whatsapp.send", "student.message"]);
const AGENT_LABEL: Record<string, string> = { whatsapp: "WhatsApp" };
const agentLabel = (id: string | null) => (id ? (AGENT_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1)) : "System");
const TOOL_LABEL: Record<string, string> = {
  "whatsapp.send": "WhatsApp reply",
  "student.message": "Message to student",
  "certificate.request": "Certificate",
};

function errorText(e: unknown) {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

/** WhatsApp free text only delivers within 24h of the customer's last message. */
function WindowChip({ lastInboundAt }: { lastInboundAt?: string | null }) {
  if (!lastInboundAt) return <span className="inline-flex items-center gap-1 text-xs text-status-warning"><AlertTriangle className="size-3.5" aria-hidden /> No message from them yet: free text can't be delivered</span>;
  const left = WINDOW_MS - (Date.now() - new Date(lastInboundAt).getTime());
  if (left <= 0) return <span className="inline-flex items-center gap-1 text-xs text-status-warning"><AlertTriangle className="size-3.5" aria-hidden /> Outside WhatsApp's 24h window: free text won't deliver</span>;
  const h = Math.floor(left / 3600_000);
  return (
    <span className="inline-flex items-center gap-1 text-xs text-status-good">
      <Clock className="size-3.5" aria-hidden /> 24h window open · {h >= 1 ? `${h}h` : `${Math.max(1, Math.round(left / 60_000))}m`} left
    </span>
  );
}

function Outcome({ a }: { a: Approval }) {
  const r = a.executionResult;
  if (a.status === "executed") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-status-good">
        <CheckCircle2 className="size-3.5" aria-hidden />
        {MESSAGE_TOOLS.has(a.tool) ? "Sent" : "Done"}{a.executedAt ? ` ${formatDateTime(a.executedAt)}` : ""}
        {r?.alreadyIssued ? " (was already issued)" : ""}
      </p>
    );
  }
  if (a.status === "approved" && r?.status === "not_executed") {
    return (
      <div role="status" className="rounded-lg border border-status-warning/40 bg-status-warning/5 p-2 text-xs text-ink-2">
        <p className="font-medium text-status-warning">Approved, but not executed: nothing was sent</p>
        <p className="mt-0.5">{r.message}</p>
      </div>
    );
  }
  if (a.status === "failed") {
    return (
      <div role="alert" className="rounded-lg border border-status-critical/40 bg-status-critical/5 p-2 text-xs text-ink-2">
        <p className="font-medium text-status-critical">Outcome unknown: not retried automatically</p>
        <p className="mt-0.5">{r?.message}</p>
      </div>
    );
  }
  return null;
}

function ApprovalCard({ a }: { a: Approval }) {
  const qc = useQueryClient();
  const text = typeof a.payload.text === "string" ? a.payload.text : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? "");
  const [note, setNote] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const canEditText = a.editableFields.includes("text") && text !== null;
  const edits = editing && draft !== text ? { text: draft } : undefined;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["approvals"] });
    void qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
  };
  const act = useMutation({
    mutationFn: (action: "approve" | "reject" | "execute" | "save") =>
      action === "save"
        ? api<DecisionResponse>(`/api/approvals/${a.id}`, { method: "PATCH", body: { edits: { text: draft } } })
        : api<DecisionResponse>(`/api/approvals/${a.id}/${action}`, {
            method: "POST",
            body: action === "execute" ? {} : { ...(note.trim() ? { note: note.trim() } : {}), ...(action === "approve" && edits ? { edits } : {}) },
          }),
    onSuccess: (_r, action) => {
      if (action !== "execute") setEditing(false);
      refresh();
    },
  });

  const pending = a.status === "pending";
  const retryable = a.status === "approved" && a.executionResult?.retryable === true;
  const tooLong = draft.length > 4096;

  return (
    <li>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-ink-3">
              {agentLabel(a.agent)} agent · {timeAgo(a.createdAt)}
            </p>
            {/* Message drafts show the text below, so the heading names the action instead of repeating it. */}
            <h2 className="mt-0.5 font-medium text-ink">{text !== null && TOOL_LABEL[a.tool] ? TOOL_LABEL[a.tool] : a.title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusBadge status={a.risk} />
            <StatusBadge status={a.status} />
          </div>
        </div>

        {(a.context.contactName || a.context.contactPhone) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-ink-2">
              To <span className="font-medium text-ink">{a.context.contactName ?? a.context.contactPhone}</span>
              {a.context.contactName && a.context.contactPhone ? <span className="tabular text-ink-3"> · {a.context.contactPhone}</span> : null}
              {a.context.course ? <span className="text-ink-3"> · {a.context.course}</span> : null}
            </span>
            {MESSAGE_TOOLS.has(a.tool) && (pending || a.status === "approved") && <WindowChip lastInboundAt={a.context.lastInboundAt} />}
          </div>
        )}

        {a.context.lastInboundText && MESSAGE_TOOLS.has(a.tool) && (
          <blockquote className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
            <span className="text-xs text-ink-3">They wrote{a.context.lastInboundAt ? ` ${timeAgo(a.context.lastInboundAt)}` : ""}:</span>
            <p className="whitespace-pre-wrap">{a.context.lastInboundText}</p>
          </blockquote>
        )}

        {text !== null ? (
          editing ? (
            <div>
              <label htmlFor={`edit-${a.id}`} className="text-xs text-ink-3">Message text</label>
              <textarea
                id={`edit-${a.id}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(12, Math.max(4, draft.split("\n").length + 1))}
                className="mt-1 w-full rounded-lg border border-line bg-surface-2 p-2 text-sm text-ink focus:border-accent focus:outline-none"
              />
              <p className={cn("text-right text-[11px]", tooLong ? "text-status-critical" : "text-ink-3")}>{draft.length} / 4096</p>
            </div>
          ) : (
            <div className="rounded-2xl rounded-br-sm border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-ink">
              <p className="whitespace-pre-wrap">{text}</p>
            </div>
          )
        ) : (
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-2 text-xs text-ink-2">{JSON.stringify(a.payload, null, 2)}</pre>
        )}

        {a.edited && (
          <div className="text-xs text-ink-3">
            <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setShowOriginal((v) => !v)}>
              <Pencil className="size-3" aria-hidden /> Edited by a person · {showOriginal ? "hide" : "show"} the agent's original
            </button>
            {showOriginal && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-2 p-2">{String(a.originalPayload.text ?? JSON.stringify(a.originalPayload))}</p>}
          </div>
        )}

        <Outcome a={a} />

        {a.decidedAt && (
          <p className="text-xs text-ink-3">
            {a.status === "expired" ? "Expired" : a.status === "rejected" ? "Rejected" : "Approved"}
            {a.decidedBy?.name ? ` by ${a.decidedBy.name}` : ""} · {formatDateTime(a.decidedAt)}
            {a.decisionNote ? <> · “{a.decisionNote}”</> : null}
          </p>
        )}

        {a.canDecide && (pending || retryable) && (
          <div className="space-y-2 border-t border-line pt-3">
            {pending && (
              <input
                aria-label="Note (optional)"
                placeholder="Note for the log (optional)"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              {pending && (
                <Button onClick={() => act.mutate("approve")} disabled={act.isPending || tooLong || (editing && !draft.trim())}>
                  <CheckCircle2 className="size-4" aria-hidden />
                  {MESSAGE_TOOLS.has(a.tool) ? (edits ? "Approve edited & send" : "Approve & send") : "Approve"}
                </Button>
              )}
              {retryable && (
                <Button onClick={() => act.mutate("execute")} disabled={act.isPending}>
                  <RotateCw className="size-4" aria-hidden /> Retry now
                </Button>
              )}
              {pending && canEditText && !editing && (
                <Button variant="secondary" onClick={() => { setDraft(text ?? ""); setEditing(true); }}>
                  <Pencil className="size-4" aria-hidden /> Edit
                </Button>
              )}
              {editing && (
                <>
                  <Button variant="secondary" onClick={() => act.mutate("save")} disabled={act.isPending || !edits || tooLong || !draft.trim()}>Save edit</Button>
                  <Button variant="ghost" onClick={() => { setEditing(false); setDraft(text ?? ""); }}>Discard</Button>
                </>
              )}
              <Button variant="ghost" className="text-status-critical" onClick={() => act.mutate("reject")} disabled={act.isPending}>
                <XCircle className="size-4" aria-hidden /> {pending ? "Reject" : "Cancel"}
              </Button>
              {a.taskId && <Link to={`/tasks/${a.taskId}`} className="ml-auto text-xs text-accent hover:underline">See agent reasoning</Link>}
            </div>
            {act.isError && <p role="alert" className="text-sm text-status-critical">{errorText(act.error)}</p>}
            {act.data?.outcome?.status === "not_executed" && <p role="status" className="text-sm text-status-warning">{act.data.outcome.message}</p>}
          </div>
        )}
        {!(a.canDecide && (pending || retryable)) && a.taskId && (
          <Link to={`/tasks/${a.taskId}`} className="block text-xs text-accent hover:underline">See agent reasoning</Link>
        )}
      </Card>
    </li>
  );
}

export function ApprovalsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "history" ? "history" : "open";
  const q = useQuery({
    queryKey: ["approvals", tab],
    queryFn: ({ signal }) => api<ApprovalList>(`/api/approvals?status=${tab === "open" ? "open" : "decided"}`, { signal }),
    refetchInterval: 15_000,
  });
  const counts = q.data?.counts;
  const items = q.data?.approvals ?? [];

  return (
    <>
      <PageHeader
        title="Approval Center"
        description="Nothing leaves the system until you approve it. Agents draft; you decide; each approved action runs exactly once and is logged."
      />
      {!can("approvals:decide") && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">
          <ShieldCheck className="size-4" aria-hidden /> Read-only: only the owner or an admin can approve, reject or edit.
        </p>
      )}
      <div role="tablist" aria-label="Approval lists" className="mb-4 flex gap-1 border-b border-line">
        {(["open", "history"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setParams(t === "open" ? {} : { tab: t })}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}
          >
            {t === "open" ? `Waiting${counts ? ` (${counts.pending + counts.approvedNotExecuted})` : ""}` : "History"}
          </button>
        ))}
        {counts && counts.failed > 0 && tab === "open" && (
          <span className="ml-auto self-center text-xs text-status-critical">{counts.failed} with unknown outcome in History</span>
        )}
      </div>

      {q.isError ? (
        <p role="alert" className="text-sm text-status-critical">{errorText(q.error)}</p>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={<CheckSquare className="size-6" />} title={q.isLoading ? "Loading…" : tab === "open" ? "Nothing waiting for you" : "No decisions yet"}>
            {tab === "open" ? "When an agent wants to send a message, issue a certificate, publish or spend, it appears here first." : "Approved, rejected and expired requests are listed here."}
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {items.map((a) => <ApprovalCard key={`${a.id}:${a.status}:${a.edited}`} a={a} />)}
        </ul>
      )}
    </>
  );
}
