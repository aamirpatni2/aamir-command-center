import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Copy, KeyRound, Link2, MessageCircle, Palette, Plug, RefreshCw, Server, ShieldCheck, Sparkles, Unplug, X } from "lucide-react";
import { Button, Card, cn, EmptyState, StatusBadge } from "@acc/ui";
import { api, ApiError } from "../lib/api.js";
import { formatDateTime, timeAgo } from "../lib/format.js";
import { PageHeader } from "../components/Layout.js";
import { AgentChip } from "../components/AgentChip.js";

interface EnvVar { name: string; set: boolean }
interface Service { id: string; label: string; kind: string; state: string; enables: string[]; env: EnvVar[]; note: string | null }
interface OAuthStatus {
  id: "google" | "canva";
  label: string;
  configured: boolean;
  missingEnv: string[];
  env: EnvVar[];
  redirectUri: string;
  scopes: string[];
  enables: string[];
  docs: string;
  connection: { status: string; accountLabel: string | null; scopes: string[]; lastError: string | null; connectedAt: string } | null;
}
interface McpTool { name: string; registryName: string; risk: string; agents: string[]; available: boolean; description: string | null; readOnlyHint: boolean | null }
interface McpServer { id: string; label: string; description: string | null; transport: string; state: string; error: string | null; missing: string[]; connectedAt: string | null; tools: McpTool[]; unlistedTools: string[] }
interface Template { name: string; language: string; status: string; category: string | null; body: string | null; bodyParams: number; syncedAt: string }
interface IntegrationsResponse { canManage: boolean; redirectUri: string; services: Service[]; oauth: OAuthStatus[]; mcp: McpServer[]; whatsappTemplates: Template[] }

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");
const SERVICE_ICON: Record<string, typeof Plug> = { anthropic: Sparkles, whatsapp: MessageCircle, web_search: Link2, embeddings: KeyRound };
const OAUTH_ICON = { google: CalendarDays, canva: Palette };

function EnvChips({ env }: { env: EnvVar[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Environment variables">
      {env.map((v) => (
        <li key={v.name} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]", v.set ? "border-status-good/25 bg-status-good/8 text-status-good" : "border-line bg-surface-2 text-ink-3")}>
          {v.set ? <Check className="size-3" aria-label="set" /> : <X className="size-3" aria-label="not set" />}
          {v.name}
        </li>
      ))}
    </ul>
  );
}

function TestButton({ path, label = "Test" }: { path: string; label?: string }) {
  const m = useMutation({ mutationFn: () => api<{ ok: boolean; message: string }>(path, { method: "POST" }) });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => m.mutate()} disabled={m.isPending}><RefreshCw className={cn("size-3.5", m.isPending && "animate-spin")} aria-hidden />{label}</Button>
      {m.data && <span role="status" className={cn("text-xs", m.data.ok ? "text-status-good" : "text-status-critical")}>{m.data.message}</span>}
      {m.isError && <span role="alert" className="text-xs text-status-critical">{errorText(m.error)}</span>}
    </span>
  );
}

function OAuthCard({ o, canManage }: { o: OAuthStatus; canManage: boolean }) {
  const qc = useQueryClient();
  const Icon = OAUTH_ICON[o.id];
  const connect = useMutation({
    mutationFn: () => api<{ url: string }>(`/api/integrations/${o.id}/connect`, { method: "POST" }),
    onSuccess: (r) => window.location.assign(r.url),
  });
  const disconnect = useMutation({
    mutationFn: () => api(`/api/integrations/${o.id}/disconnect`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["integrations"] }),
  });
  const [copied, setCopied] = useState(false);
  const c = o.connection;
  const state = c ? c.status : o.configured ? "not_connected" : "not_configured";

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-display text-[15px] font-semibold text-ink">
          <span className="grid size-8 place-items-center rounded-xl bg-viz-sky/12 text-viz-sky ring-1 ring-viz-sky/25 ring-inset" aria-hidden><Icon className="size-4" /></span>
          {o.label}
        </h2>
        <StatusBadge status={state} label={state === "not_connected" ? "Ready to connect" : undefined} />
      </div>
      {c?.accountLabel && <p className="mt-3 text-sm text-ink-2">Connected as <span className="font-medium text-ink">{c.accountLabel}</span> · {timeAgo(c.connectedAt)}</p>}
      {c?.lastError && <p className="mt-2 text-sm text-status-critical">{c.lastError}: reconnect to continue.</p>}
      <ul className="mt-3 space-y-1 text-sm text-ink-2">{o.enables.map((e) => <li key={e} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-status-good" aria-hidden />{e}</li>)}</ul>
      {!o.configured && (
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink-2">
          <p className="mb-2 font-medium text-ink">To set up</p>
          <p>{o.docs}</p>
          <p className="mt-2">Redirect URL to register:</p>
          <p className="mt-1 flex items-center gap-2">
            <code className="truncate rounded-md bg-bg px-2 py-1 text-[11px] text-ink">{o.redirectUri}</code>
            <button type="button" className="rounded-md p-1 text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Copy redirect URL" onClick={() => void navigator.clipboard.writeText(o.redirectUri).then(() => setCopied(true))}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </p>
          <p className="mt-2">Then set these in the server's .env and restart:</p>
        </div>
      )}
      <div className="mt-3"><EnvChips env={o.env} /></div>
      {canManage && o.configured && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button className="px-3 py-1.5 text-xs" onClick={() => connect.mutate()} disabled={connect.isPending}><Plug className="size-3.5" aria-hidden />{c ? "Reconnect" : `Connect ${o.label}`}</Button>
          {c && <TestButton path={`/api/integrations/${o.id}/test`} />}
          {c && <Button variant="ghost" className="px-2.5 py-1 text-xs text-status-critical" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}><Unplug className="size-3.5" aria-hidden />Disconnect</Button>}
          {(connect.isError || disconnect.isError) && <span role="alert" className="text-xs text-status-critical">{errorText(connect.error ?? disconnect.error)}</span>}
        </div>
      )}
    </Card>
  );
}

function McpServerCard({ s, canManage }: { s: McpServer; canManage: boolean }) {
  const qc = useQueryClient();
  const test = useMutation({
    mutationFn: () => api<{ server: McpServer }>(`/api/integrations/mcp/${s.id}/test`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["integrations"] }),
  });
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink"><Server className="size-4 text-viz-violet" aria-hidden />{s.label}<span className="font-mono text-xs font-normal text-ink-3">{s.id} · {s.transport}</span></h3>
          {s.description && <p className="mt-1 text-sm text-ink-2">{s.description}</p>}
        </div>
        <StatusBadge status={s.state} />
      </div>
      {s.error && <p className="mt-2 rounded-lg border border-status-critical/25 bg-status-critical/5 px-3 py-2 text-xs text-status-critical">{s.error}</p>}
      {s.missing.length > 0 && <p className="mt-2 text-xs text-status-warning">Needs {s.missing.join(", ")} in .env.</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line"><tr>{["Tool", "Risk", "Agents", "Available"].map((h) => <th key={h} className="py-2 pr-4 whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {s.tools.map((t) => (
              <tr key={t.name}>
                <td className="py-2 pr-4"><span className="font-mono text-xs text-ink">{t.name}</span>{t.description && <span className="block max-w-md truncate text-xs text-ink-3">{t.description}</span>}</td>
                <td className="py-2 pr-4"><StatusBadge status={t.risk} label={t.risk} /></td>
                <td className="py-2 pr-4"><span className="flex flex-wrap gap-1">{t.agents.map((a) => <AgentChip key={a} id={a} withLabel={false} className="[&>span]:size-6" />)}</span></td>
                <td className="py-2 pr-4 text-xs">{t.available ? <span className="text-status-good">Yes</span> : <span className="text-ink-3">No</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs text-ink-3">
        {s.connectedAt && <span>Connected {formatDateTime(s.connectedAt)}</span>}
        {s.unlistedTools.length > 0 && <span title={s.unlistedTools.join(", ")}>{s.unlistedTools.length} other tool(s) offered by the server are not exposed</span>}
        {canManage && <Button variant="secondary" className="ml-auto px-2.5 py-1 text-xs" onClick={() => test.mutate()} disabled={test.isPending}><RefreshCw className={cn("size-3.5", test.isPending && "animate-spin")} aria-hidden />Reconnect & test</Button>}
      </div>
    </Card>
  );
}

export function IntegrationsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["integrations"], queryFn: ({ signal }) => api<IntegrationsResponse>("/api/integrations", { signal }), refetchInterval: 30_000 });
  const sync = useMutation({
    mutationFn: () => api<{ synced: number; approved: number }>("/api/whatsapp/templates/sync", { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["integrations"] }),
  });
  const flash = params.get("connected") ? { ok: true, text: `${params.get("connected") === "google" ? "Google" : "Canva"} connected.` } : params.get("error") ? { ok: false, text: params.get("error")! } : null;
  useEffect(() => {
    if (flash) void qc.invalidateQueries({ queryKey: ["integrations"] });
  }, [flash?.text]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = q.data;

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Every outside connection your agents use. Keys live only in the server's .env; this page shows whether they're set, never their values. Anything that sends or publishes still goes through the Approval Center."
      />
      {flash && (
        <p role={flash.ok ? "status" : "alert"} className={cn("mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm", flash.ok ? "border-status-good/30 bg-status-good/10 text-status-good" : "border-status-critical/30 bg-status-critical/10 text-status-critical")}>
          {flash.text}
          <button type="button" onClick={() => setParams({})} aria-label="Dismiss" className="rounded p-1 hover:bg-surface-2"><X className="size-4" /></button>
        </p>
      )}
      {q.isError && <p role="alert" className="text-sm text-status-critical">{errorText(q.error)}</p>}
      {!d ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="shimmer h-44 rounded-2xl" />)}</div>
      ) : (
        <>
          <h2 className="mb-3 text-sm font-semibold text-ink">Core services</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {d.services.map((s) => {
              const Icon = SERVICE_ICON[s.id] ?? Plug;
              return (
                <Card key={s.id}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="flex items-center gap-2.5 font-display text-[15px] font-semibold text-ink">
                      <span className="grid size-8 place-items-center rounded-xl bg-viz-indigo/12 text-viz-indigo ring-1 ring-viz-indigo/25 ring-inset" aria-hidden><Icon className="size-4" /></span>
                      {s.label}
                    </h3>
                    <StatusBadge status={s.state} label={s.state === "partial" ? "Partly set up" : undefined} />
                  </div>
                  <ul className="mt-3 space-y-1 text-sm text-ink-2">{s.enables.map((e) => <li key={e} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-status-good" aria-hidden />{e}</li>)}</ul>
                  {s.note && <p className="mt-2 text-xs text-ink-3">{s.note}</p>}
                  <div className="mt-3"><EnvChips env={s.env} /></div>
                  {d.canManage && s.id === "whatsapp" && <div className="mt-3 border-t border-line pt-3"><TestButton path="/api/integrations/whatsapp/test" label="Test sending credentials" /></div>}
                </Card>
              );
            })}
          </div>

          <h2 className="mt-8 mb-3 text-sm font-semibold text-ink">Accounts (OAuth) <span className="font-normal text-ink-3">· connect once; tokens are stored encrypted</span></h2>
          <div className="grid gap-4 md:grid-cols-2">{d.oauth.map((o) => <OAuthCard key={o.id} o={o} canManage={d.canManage} />)}</div>

          <Card
            className="mt-8"
            title="WhatsApp message templates"
            icon={<MessageCircle className="size-4" />}
            action={<Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => sync.mutate()} disabled={sync.isPending}><RefreshCw className={cn("size-3.5", sync.isPending && "animate-spin")} aria-hidden />Sync from WhatsApp</Button>}
          >
            <p className="mb-3 text-sm text-ink-2">Templates are created and approved in WhatsApp Manager. Only approved ones can be sent, and they're the only way to message someone more than 24 hours after their last message.</p>
            {sync.isError && <p role="alert" className="mb-3 text-sm text-status-critical">{errorText(sync.error)}</p>}
            {sync.data && <p role="status" className="mb-3 text-sm text-status-good">Synced {sync.data.synced} template(s), {sync.data.approved} approved.</p>}
            {d.whatsappTemplates.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line"><tr>{["Template", "Status", "Params", "Body"].map((h) => <th key={h} className="py-2 pr-4 whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {d.whatsappTemplates.map((t) => (
                      <tr key={`${t.name}|${t.language}`} className="align-top">
                        <td className="py-2 pr-4"><span className="font-mono text-xs text-ink">{t.name}</span><span className="block text-xs text-ink-3">{t.language}{t.category ? ` · ${t.category.toLowerCase()}` : ""}</span></td>
                        <td className="py-2 pr-4"><StatusBadge status={t.status} /></td>
                        <td className="tabular py-2 pr-4 text-ink-2">{t.bodyParams}</td>
                        <td className="max-w-lg py-2 pr-4 text-xs text-ink-2">{t.body}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={<MessageCircle className="size-5" />} title="No templates synced">Needs WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID, then Sync.</EmptyState>
            )}
          </Card>

          <h2 className="mt-8 mb-1 text-sm font-semibold text-ink">MCP servers</h2>
          <p className="mb-3 flex items-center gap-1.5 text-xs text-ink-3"><ShieldCheck className="size-3.5" aria-hidden />Defined in mcp.config.json on the server (not editable here, since a server runs a program). Only allow-listed tools are exposed, each with a risk level and the agents allowed to use it.</p>
          {d.mcp.length ? (
            <div className="space-y-4">{d.mcp.map((s) => <McpServerCard key={s.id} s={s} canManage={d.canManage} />)}</div>
          ) : (
            <Card><EmptyState icon={<Server className="size-5" />} title="No MCP servers configured">Add servers to mcp.config.json at the repository root.</EmptyState></Card>
          )}
        </>
      )}
    </>
  );
}
