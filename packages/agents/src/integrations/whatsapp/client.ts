/**
 * WhatsApp Cloud API client (official Meta Graph API). Used only to execute APPROVED sends
 * (Approval Center). Returns not_configured when credentials are missing. A thrown error means
 * the outcome is unknown (the request may have reached Meta), so callers must not blindly retry.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface WhatsAppConfig {
  accessToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  graphVersion: string;
}

export interface RemoteTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: { type: string; text?: string; format?: string }[];
}

export type SendResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "not_configured"; missing: string[] }
  | { status: "error"; httpStatus: number; code?: number; message: string };

export class WhatsAppClient {
  constructor(
    private readonly cfg: WhatsAppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  missing(): string[] {
    return [!this.cfg.accessToken && "WHATSAPP_ACCESS_TOKEN", !this.cfg.phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID"].filter(Boolean) as string[];
  }

  missingForTemplates(): string[] {
    return [!this.cfg.accessToken && "WHATSAPP_ACCESS_TOKEN", !this.cfg.businessAccountId && "WHATSAPP_BUSINESS_ACCOUNT_ID"].filter(Boolean) as string[];
  }

  /** All message templates of the WhatsApp Business Account (follows paging, max 5 pages). */
  async listTemplates(): Promise<{ status: "ok"; templates: RemoteTemplate[] } | { status: "not_configured"; missing: string[] } | { status: "error"; message: string }> {
    const missing = this.missingForTemplates();
    if (missing.length) return { status: "not_configured", missing };
    const out: RemoteTemplate[] = [];
    let url: string | null = `https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.businessAccountId}/message_templates?fields=id,name,language,status,category,components&limit=100`;
    for (let page = 0; url && page < 5; page++) {
      const res: Response = await this.fetchImpl(url, { headers: { authorization: `Bearer ${this.cfg.accessToken}` }, signal: AbortSignal.timeout(15_000) });
      const data = (await res.json().catch(() => ({}))) as { data?: RemoteTemplate[]; paging?: { next?: string }; error?: { message?: string } };
      if (!res.ok) return { status: "error", message: data.error?.message ?? `HTTP ${res.status}` };
      out.push(...(data.data ?? []));
      url = data.paging?.next ?? null;
    }
    return { status: "ok", templates: out };
  }

  /** Sends an approved template (allowed outside the 24-hour window). Body parameters fill {{1}}, {{2}}, … */
  async sendTemplate(to: string, name: string, language: string, bodyParams: string[]): Promise<SendResult> {
    const missing = this.missing();
    if (missing.length) return { status: "not_configured", missing };
    const res = await this.fetchImpl(`https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.accessToken}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace(/^\+/, ""),
        type: "template",
        template: { name, language: { code: language }, ...(bodyParams.length ? { components: [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }] } : {}) },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { code?: number; message?: string } };
    if (!res.ok || !data.messages?.[0]?.id) {
      return { status: "error", httpStatus: res.status, code: data.error?.code, message: data.error?.message ?? `HTTP ${res.status}` };
    }
    return { status: "sent", providerMessageId: data.messages[0].id };
  }

  /** Cheap credentials check for the Integrations page. */
  async checkPhoneNumber(): Promise<{ ok: boolean; message: string }> {
    const missing = this.missing();
    if (missing.length) return { ok: false, message: `Not configured: ${missing.join(", ")}` };
    const res = await this.fetchImpl(`https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.phoneNumberId}?fields=display_phone_number,verified_name`, { headers: { authorization: `Bearer ${this.cfg.accessToken}` }, signal: AbortSignal.timeout(10_000) });
    const data = (await res.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
    return res.ok ? { ok: true, message: `Connected: ${data.verified_name ?? ""} ${data.display_phone_number ?? ""}`.trim() } : { ok: false, message: data.error?.message ?? `HTTP ${res.status}` };
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    const missing = this.missing();
    if (missing.length) return { status: "not_configured", missing };
    const res = await this.fetchImpl(`https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.accessToken}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "text", text: { preview_url: false, body } }),
    });
    const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { code?: number; message?: string } };
    if (!res.ok || !data.messages?.[0]?.id) {
      return { status: "error", httpStatus: res.status, code: data.error?.code, message: data.error?.message ?? `HTTP ${res.status}` };
    }
    return { status: "sent", providerMessageId: data.messages[0].id };
  }
}

/** Verifies Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret). */
export function verifyWhatsappSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function signWhatsappBody(rawBody: string | Buffer, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

/** WhatsApp only allows free-form replies within 24h of the customer's last message; after that, templates. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 3600_000;
