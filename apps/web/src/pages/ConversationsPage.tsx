import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, MessagesSquare, PauseCircle } from "lucide-react";
import { Button, Card, EmptyState, StatusBadge, cn } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { formatDateTime, timeAgo } from "../lib/format.js";
import type { ConversationDetail, ConversationRow } from "../lib/crm-types.js";
import { PageHeader } from "../components/Layout.js";

function Thread({ id }: { id: string }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["conversation", id],
    queryFn: ({ signal }) => api<ConversationDetail>(`/api/conversations/${id}`, { signal }),
    refetchInterval: 10_000,
  });
  const triage = useMutation({
    mutationFn: () => api<{ task: { id: string } }>(`/api/conversations/${id}/triage`, { method: "POST" }),
    onSuccess: (r) => navigate(`/tasks/${r.task.id}`),
  });
  if (!q.data) return <p className="p-4 text-sm text-ink-3">{q.isError ? (q.error as Error).message : "Loading…"}</p>;
  const { contact, lead, messages, drafts } = q.data;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
        <div>
          <div className="font-medium text-ink">{contact.name ?? contact.phone}</div>
          <div className="tabular text-xs text-ink-3">{contact.phone} · WhatsApp</div>
        </div>
        <div className="flex items-center gap-2">
          {lead && (
            <Link to={`/leads/${lead.id}`} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-xs text-ink-2 hover:bg-surface-2">
              <StatusBadge status={lead.band} /> score {lead.score} · {lead.status}
            </Link>
          )}
          {can("tasks:create") && (
            <Button variant="secondary" onClick={() => triage.mutate()} disabled={triage.isPending}>
              <Bot className="size-4" aria-hidden /> Ask WhatsApp Agent
            </Button>
          )}
        </div>
      </div>
      {triage.isError && <p role="alert" className="px-4 pt-2 text-sm text-status-critical">{triage.error instanceof ApiError ? triage.error.message : "Failed"}</p>}

      <ol className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.map((m) => (
          <li key={m.id} className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", m.direction === "outbound" ? "rounded-br-sm bg-accent/20 text-ink" : "rounded-bl-sm bg-surface-2 text-ink")}>
              <p className="whitespace-pre-wrap">{m.body ?? <em className="text-ink-3">[media]</em>}</p>
              <p className="mt-1 text-right text-[10px] text-ink-3">{formatDateTime(m.createdAt)}{m.direction === "outbound" ? ` · ${m.status}` : ""}</p>
            </div>
          </li>
        ))}
        {drafts.map((d) => (
          <li key={d.id} className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-br-sm border border-dashed border-status-warning/50 bg-status-warning/5 px-3 py-2 text-sm">
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-status-warning"><PauseCircle className="size-3.5" aria-hidden /> Draft · waiting for your approval</p>
              <p className="whitespace-pre-wrap text-ink">{d.text}</p>
              {d.taskId && <Link to={`/tasks/${d.taskId}`} className="mt-1 block text-right text-[11px] text-accent hover:underline">see agent reasoning</Link>}
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t border-line px-4 py-2 text-xs text-ink-3">Replies are drafted by the WhatsApp Agent and sent only after approval (Approval Center, Milestone 9).</p>
    </div>
  );
}

export function ConversationsPage() {
  const { id } = useParams();
  const list = useQuery({
    queryKey: ["conversations"],
    queryFn: ({ signal }) => api<{ conversations: ConversationRow[] }>("/api/conversations", { signal }),
    refetchInterval: 10_000,
  });
  const rows = list.data?.conversations ?? [];

  return (
    <>
      <PageHeader title="Conversations" description="WhatsApp inbox. New messages are triaged by the WhatsApp Agent; replies wait for your approval." />
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<MessagesSquare className="size-6" />} title={list.isLoading ? "Loading…" : "No conversations yet"}>
            Messages arrive through the WhatsApp Cloud API webhook. For local testing run <code className="text-ink-2">pnpm whatsapp:simulate "Salam, fee kitni hai?"</code>.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:h-[calc(100vh-11rem)] lg:grid-cols-[20rem_1fr]">
          <Card className={cn("overflow-y-auto p-0", id && "hidden lg:block")}>
            <ul className="divide-y divide-line">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link to={`/conversations/${c.id}`} className={cn("block px-4 py-3 hover:bg-surface-2", c.id === id && "bg-accent/10")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{c.contactName ?? c.contactPhone}</span>
                      <span className="shrink-0 text-xs text-ink-3">{c.lastMessageAt ? timeAgo(c.lastMessageAt) : ""}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-2">{c.lastDirection === "outbound" ? "You: " : ""}{c.lastMessage ?? "—"}</p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {c.band && <StatusBadge status={c.band} />}
                      {c.pendingDrafts > 0 && <StatusBadge status="pending" label={`${c.pendingDrafts} draft${c.pendingDrafts > 1 ? "s" : ""}`} />}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card className={cn("min-h-96 p-0", !id && "hidden lg:block")}>
            {id ? <Thread id={id} /> : <EmptyState icon={<MessagesSquare className="size-6" />} title="Select a conversation" />}
          </Card>
        </div>
      )}
    </>
  );
}
