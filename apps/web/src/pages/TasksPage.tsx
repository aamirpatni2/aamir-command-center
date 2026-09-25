import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, ListChecks, Send } from "lucide-react";
import { Button, Card, EmptyState, StatusBadge } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { timeAgo } from "../lib/format.js";
import type { TaskListItem } from "../lib/types.js";
import { PageHeader } from "../components/Layout.js";

interface AgentsInfo {
  model: { available: boolean; mock: boolean; reason?: string };
}

const EXAMPLES = [
  "Hamare courses aur unki fees kya hain?",
  "Summarise what you know about the next batch and list what information is missing.",
  "Remember: I prefer WhatsApp replies in Roman Urdu.",
];

export function ModelBanner({ info }: { info?: AgentsInfo }) {
  if (!info) return null;
  if (!info.model.available) {
    return (
      <p role="alert" className="mb-4 rounded-lg border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-sm text-status-critical">
        No model configured: {info.model.reason}
      </p>
    );
  }
  if (info.model.mock) {
    return (
      <p className="mb-4 flex items-start gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm text-status-warning">
        <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong>Mock model.</strong> ANTHROPIC_API_KEY isn't set, so agents run on a clearly labelled simulator. Everything else
          (tools, database, approvals, logs) is real. Add the key to the server environment to use Claude.
        </span>
      </p>
    );
  }
  return null;
}

export function TasksPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const agents = useQuery({ queryKey: ["agents"], queryFn: ({ signal }) => api<AgentsInfo>("/api/agents", { signal }) });
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: ({ signal }) => api<{ tasks: TaskListItem[] }>("/api/tasks?limit=50", { signal }),
    refetchInterval: (q) => (q.state.data?.tasks.some((t) => ["QUEUED", "RUNNING"].includes(t.status)) ? 3000 : 20_000),
  });

  const create = useMutation({
    mutationFn: (text: string) => api<{ task: TaskListItem }>("/api/tasks", { method: "POST", body: { input: text } }),
    onSuccess: ({ task }) => {
      setInput("");
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      navigate(`/tasks/${task.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not create the task."),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (input.trim().length >= 3) create.mutate(input.trim());
  }

  return (
    <>
      <PageHeader title="Tasks" description="Give the Orchestrator a task. It plans, uses tools, and asks for your approval before anything leaves the system." />
      <ModelBanner info={agents.data} />

      {can("tasks:create") && (
        <Card className="mb-4">
          <form onSubmit={onSubmit} className="space-y-3">
            <label htmlFor="task-input" className="block text-sm text-ink-2">New task</label>
            <textarea
              id="task-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="e.g. Find today's important AI developments and turn them into three Reel ideas"
              className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-ink placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(e);
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button type="button" key={ex} onClick={() => setInput(ex)} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-surface-2">
                    {ex.length > 48 ? `${ex.slice(0, 48)}…` : ex}
                  </button>
                ))}
              </div>
              <Button type="submit" disabled={create.isPending || input.trim().length < 3 || !agents.data?.model.available}>
                <Send className="size-4" aria-hidden /> {create.isPending ? "Sending…" : "Run task"}
              </Button>
            </div>
            {error && <p role="alert" className="text-sm text-status-critical">{error}</p>}
          </form>
        </Card>
      )}

      <Card title="Recent tasks" className="p-0 [&>header]:px-4 [&>header]:pt-4">
        {tasks.data?.tasks.length ? (
          <ul className="divide-y divide-line">
            {tasks.data.tasks.map((t) => (
              <li key={t.id}>
                <Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink">{t.title}</div>
                    <div className="text-xs text-ink-3">
                      {t.requestedBy ?? t.source} · {timeAgo(t.createdAt)}
                      {t.error ? ` · ${t.error}` : ""}
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<ListChecks className="size-6" />} title={tasks.isLoading ? "Loading…" : "No tasks yet"}>
            Tasks you give the Orchestrator appear here with their live status.
          </EmptyState>
        )}
      </Card>
    </>
  );
}
