/**
 * WhatsApp Cloud API client (official Meta Graph API). Used only to execute APPROVED sends
 * (Approval Center, Milestone 9). Returns not_configured when credentials are missing.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface WhatsAppConfig {
  accessToken?: string;
  phoneNumberId?: string;
  graphVersion: string;
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

  async sendText(to: string, body: string): Promise<SendResult> {
    const missing = this.missing();
    if (missing.length) return { status: "not_configured", missing };
    const res = await this.fetchImpl(`https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.accessToken}`, "content-type": "application/json" },
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
