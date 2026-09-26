import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, MousePointerClick, Target, Wallet } from "lucide-react";
import { Card, cn, EmptyState, StatTile } from "@acc/ui";
import { api } from "../lib/api.js";
import { formatCount } from "../lib/format.js";
import { PageHeader } from "../components/Layout.js";

interface Campaign { campaignId: string; name: string; spend: number; impressions: number; clicks: number; leads: number; ctr: number | null; costPerLead: number | null }
type AdsResult =
  | { status: "ok"; currency: string; accountName: string | null; campaigns: Campaign[]; totals: { spend: number; leads: number; clicks: number; impressions: number; costPerLead: number | null } }
  | { status: "not_configured"; missing: string[] }
  | { status: "error"; message: string };

const PRESETS = [{ id: "last_7d", label: "7 days" }, { id: "last_30d", label: "30 days" }, { id: "last_90d", label: "90 days" }] as const;

export function AdsPage() {
  const [params, setParams] = useSearchParams();
  const preset = PRESETS.find((p) => p.id === params.get("range"))?.id ?? "last_7d";
  const q = useQuery({ queryKey: ["ads", preset], queryFn: ({ signal }) => api<AdsResult>(`/api/ads?preset=${preset}`, { signal }) });
  const d = q.data;
  const money = (v: number, cur: string) => `${cur} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 }).format(v)}`;

  return (
    <>
      <PageHeader
        title="Ads"
        description="Meta (Facebook & Instagram) campaign results, read-only. Nothing here can change a campaign or a budget."
        action={d?.status === "ok" ? (
          <div role="tablist" aria-label="Period" className="flex gap-1 rounded-xl border border-line bg-surface-2 p-1">
            {PRESETS.map((p) => (
              <button key={p.id} role="tab" aria-selected={preset === p.id} onClick={() => setParams({ range: p.id })} className={cn("rounded-lg px-3 py-1 text-xs", preset === p.id ? "bg-accent/20 text-ink" : "text-ink-3 hover:text-ink")}>{p.label}</button>
            ))}
          </div>
        ) : undefined}
      />
      {!d ? (
        <div className="shimmer h-40 rounded-2xl" />
      ) : d.status === "not_configured" ? (
        <Card>
          <EmptyState icon={<Megaphone className="size-5" />} title="Meta Ads isn't connected">
            Set {d.missing.join(" and ")} in the server's .env (a system-user token with <code>ads_read</code> only). See <Link to="/mcp" className="text-accent hover:underline">Integrations</Link>.
          </EmptyState>
        </Card>
      ) : d.status === "error" ? (
        <p role="alert" className="rounded-xl border border-status-critical/30 bg-status-critical/10 px-4 py-3 text-sm text-status-critical">Meta returned an error: {d.message}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile tone="rose" label="Spend" icon={<Wallet className="size-4" />} value={money(d.totals.spend, d.currency)} note={d.accountName ?? undefined} />
            <StatTile tone="emerald" label="Leads" icon={<Target className="size-4" />} value={formatCount(d.totals.leads)} />
            <StatTile tone="amber" label="Cost per lead" icon={<Target className="size-4" />} value={d.totals.costPerLead === null ? "—" : money(d.totals.costPerLead, d.currency)} />
            <StatTile tone="sky" label="Clicks" icon={<MousePointerClick className="size-4" />} value={formatCount(d.totals.clicks)} note={`${formatCount(d.totals.impressions)} impressions`} />
          </div>
          <Card title="Campaigns" className="mt-4 p-0 [&>header]:px-5 [&>header]:pt-5">
            {d.campaigns.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line"><tr>{["Campaign", "Spend", "Leads", "Cost / lead", "Clicks", "CTR"].map((h) => <th key={h} className="px-5 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {d.campaigns.map((c) => (
                      <tr key={c.campaignId}>
                        <td className="px-5 py-2 text-ink">{c.name}</td>
                        <td className="tabular px-5 py-2 text-ink-2">{money(c.spend, d.currency)}</td>
                        <td className="tabular px-5 py-2 text-ink">{c.leads}</td>
                        <td className="tabular px-5 py-2 text-ink-2">{c.costPerLead === null ? "—" : money(c.costPerLead, d.currency)}</td>
                        <td className="tabular px-5 py-2 text-ink-2">{formatCount(c.clicks)}</td>
                        <td className="tabular px-5 py-2 text-ink-2">{c.ctr === null ? "—" : `${c.ctr}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={<Megaphone className="size-5" />} title="No campaign activity in this period" />}
          </Card>
        </>
      )}
    </>
  );
}
