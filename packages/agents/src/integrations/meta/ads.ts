/**
 * Meta Marketing API, read-only (ads_read). Never creates or changes campaigns or budgets:
 * spending money is out of scope until an owner-only, approval-gated flow exists.
 */
export type AdsPreset = "last_7d" | "last_30d" | "last_90d";

export interface CampaignInsight {
  campaignId: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number | null;
  costPerLead: number | null;
}

export type AdsResult =
  | { status: "ok"; currency: string; accountName: string | null; preset: AdsPreset; campaigns: CampaignInsight[]; totals: { spend: number; leads: number; clicks: number; impressions: number; costPerLead: number | null } }
  | { status: "not_configured"; missing: string[] }
  | { status: "error"; message: string };

const LEAD_ACTIONS = new Set(["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_conversion.messaging_conversation_started_7d"]);

export class MetaAdsClient {
  private cache: { key: string; at: number; value: AdsResult } | null = null;
  constructor(
    private readonly cfg: { accessToken?: string; adAccountId?: string; graphVersion: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  missing() {
    return [!this.cfg.accessToken && "META_ADS_ACCESS_TOKEN", !this.cfg.adAccountId && "META_AD_ACCOUNT_ID"].filter(Boolean) as string[];
  }

  private account() {
    const id = this.cfg.adAccountId!.replace(/^act_/, "");
    return `https://graph.facebook.com/${this.cfg.graphVersion}/act_${id}`;
  }

  /** Campaign-level spend, clicks and leads. Cached for 10 minutes (the API is rate-limited). */
  async campaignInsights(preset: AdsPreset = "last_7d"): Promise<AdsResult> {
    const missing = this.missing();
    if (missing.length) return { status: "not_configured", missing };
    if (this.cache && this.cache.key === preset && Date.now() - this.cache.at < 10 * 60_000) return this.cache.value;
    const headers = { authorization: `Bearer ${this.cfg.accessToken}` };
    try {
      const accRes = await this.fetchImpl(`${this.account()}?fields=name,currency`, { headers, signal: AbortSignal.timeout(15_000) });
      const acc = (await accRes.json().catch(() => ({}))) as { name?: string; currency?: string; error?: { message?: string } };
      if (!accRes.ok) return { status: "error", message: acc.error?.message ?? `HTTP ${accRes.status}` };
      const q = new URLSearchParams({ level: "campaign", date_preset: preset, fields: "campaign_id,campaign_name,spend,impressions,clicks,actions", limit: "100" });
      const res = await this.fetchImpl(`${this.account()}/insights?${q}`, { headers, signal: AbortSignal.timeout(20_000) });
      const data = (await res.json().catch(() => ({}))) as { data?: { campaign_id: string; campaign_name: string; spend?: string; impressions?: string; clicks?: string; actions?: { action_type: string; value: string }[] }[]; error?: { message?: string } };
      if (!res.ok) return { status: "error", message: data.error?.message ?? `HTTP ${res.status}` };
      const campaigns = (data.data ?? []).map((c) => {
        const spend = Number(c.spend ?? 0);
        const impressions = Number(c.impressions ?? 0);
        const clicks = Number(c.clicks ?? 0);
        const leads = (c.actions ?? []).filter((a) => LEAD_ACTIONS.has(a.action_type)).reduce((t, a) => t + Number(a.value), 0);
        return { campaignId: c.campaign_id, name: c.campaign_name, spend, impressions, clicks, leads, ctr: impressions ? Math.round((clicks / impressions) * 10_000) / 100 : null, costPerLead: leads ? Math.round((spend / leads) * 100) / 100 : null };
      });
      const totals = campaigns.reduce((t, c) => ({ spend: t.spend + c.spend, leads: t.leads + c.leads, clicks: t.clicks + c.clicks, impressions: t.impressions + c.impressions }), { spend: 0, leads: 0, clicks: 0, impressions: 0 });
      const value: AdsResult = {
        status: "ok", currency: acc.currency ?? "PKR", accountName: acc.name ?? null, preset,
        campaigns: campaigns.sort((a, b) => b.spend - a.spend),
        totals: { ...totals, spend: Math.round(totals.spend * 100) / 100, costPerLead: totals.leads ? Math.round((totals.spend / totals.leads) * 100) / 100 : null },
      };
      this.cache = { key: preset, at: Date.now(), value };
      return value;
    } catch (e) {
      return { status: "error", message: (e as Error).message };
    }
  }
}
