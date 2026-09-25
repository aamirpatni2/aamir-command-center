import { useInfiniteQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { Button, Card, EmptyState } from "@acc/ui";
import { api } from "../lib/api.js";
import { formatDateTime } from "../lib/format.js";
import { PageHeader } from "../components/Layout.js";

interface AuditLog {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export function LogsPage() {
  const q = useInfiniteQuery({
    queryKey: ["audit-logs"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api<{ auditLogs: AuditLog[]; nextBefore: string | null }>(
        `/api/audit-logs?limit=50${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextBefore,
  });
  const rows = q.data?.pages.flatMap((p) => p.auditLogs) ?? [];

  return (
    <>
      <PageHeader title="Logs" description="Append-only audit log: sign-ins, account changes and, later, every agent action and approval." />
      <Card className="p-0">
        {q.isError && <p role="alert" className="p-4 text-sm text-status-critical">{(q.error as Error).message}</p>}
        {!q.isLoading && rows.length === 0 ? (
          <EmptyState icon={<ScrollText className="size-6" />} title="No audit entries yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2 font-medium">Time (PKT)</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Actor</th>
                  <th className="px-4 py-2 font-medium">Entity</th>
                  <th className="px-4 py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="tabular px-4 py-2 whitespace-nowrap text-ink-2">{formatDateTime(r.createdAt)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink">{r.action}</td>
                    <td className="px-4 py-2 text-ink-2">{r.actorType}{r.actorId ? ` · ${r.actorId.slice(0, 8)}` : ""}</td>
                    <td className="px-4 py-2 text-ink-2">{r.entityType ? `${r.entityType}${r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ""}` : "—"}</td>
                    <td className="tabular px-4 py-2 text-ink-3">{r.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <Button variant="secondary" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage ? "Loading…" : "Load older"}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
