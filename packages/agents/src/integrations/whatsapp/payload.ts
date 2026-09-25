/**
 * Parses WhatsApp Cloud API webhook payloads (object = "whatsapp_business_account").
 * Only the fields we use; everything else is ignored. Unknown message types are kept with text = null.
 */
import { z } from "zod";

const message = z.object({
  from: z.string().regex(/^\d{6,15}$/),
  id: z.string().min(1).max(256),
  timestamp: z.string().regex(/^\d+$/),
  type: z.string(),
  text: z.object({ body: z.string().max(10_000) }).optional(),
  button: z.object({ text: z.string().max(1000) }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ title: z.string() }).optional(),
      list_reply: z.object({ title: z.string() }).optional(),
    })
    .optional(),
  image: z.object({ id: z.string(), caption: z.string().optional(), mime_type: z.string().optional() }).optional(),
  audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  document: z.object({ id: z.string(), filename: z.string().optional(), caption: z.string().optional() }).optional(),
});

const status = z.object({
  id: z.string(),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  recipient_id: z.string().optional(),
});

export const whatsappWebhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z
    .array(
      z.object({
        id: z.string(),
        changes: z.array(
          z.object({
            field: z.string(),
            value: z.object({
              messaging_product: z.literal("whatsapp").optional(),
              metadata: z.object({ phone_number_id: z.string() }).optional(),
              contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().max(200) }).optional() })).optional(),
              messages: z.array(message).optional(),
              statuses: z.array(status).optional(),
            }),
          }),
        ),
      }),
    )
    .max(50),
});

export interface ParsedInbound {
  from: string;
  profileName: string | null;
  providerMessageId: string;
  text: string | null;
  media: Record<string, unknown>[] | null;
  sentAt: Date;
  phoneNumberId: string | null;
}

export interface ParsedStatus {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
}

export function parseWhatsappWebhook(body: unknown): { messages: ParsedInbound[]; statuses: ParsedStatus[] } | null {
  const parsed = whatsappWebhookSchema.safeParse(body);
  if (!parsed.success) return null;
  const messages: ParsedInbound[] = [];
  const statuses: ParsedStatus[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const v = change.value;
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
      for (const m of v.messages ?? []) {
        const text =
          m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ??
          m.image?.caption ?? m.document?.caption ?? null;
        const media = m.image ? [{ type: "image", ...m.image }] : m.audio ? [{ type: "audio", ...m.audio }] : m.document ? [{ type: "document", ...m.document }] : null;
        messages.push({
          from: m.from,
          profileName: names.get(m.from) ?? null,
          providerMessageId: m.id,
          text,
          media,
          sentAt: new Date(Number(m.timestamp) * 1000),
          phoneNumberId: v.metadata?.phone_number_id ?? null,
        });
      }
      for (const s of v.statuses ?? []) statuses.push({ providerMessageId: s.id, status: s.status });
    }
  }
  return { messages, statuses };
}

/** Builds a Cloud-API-shaped inbound text payload. Used by tests and the local simulator script. */
export function buildWhatsappTextPayload(m: { from: string; name?: string; id: string; text: string; timestamp?: number; phoneNumberId?: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "923000000000", phone_number_id: m.phoneNumberId ?? "PHONE_NUMBER_ID" },
              contacts: [{ wa_id: m.from, profile: { name: m.name ?? "Customer" } }],
              messages: [{ from: m.from, id: m.id, timestamp: String(m.timestamp ?? Math.floor(Date.now() / 1000)), type: "text", text: { body: m.text } }],
            },
          },
        ],
      },
    ],
  };
}

export function buildWhatsappStatusPayload(s: { id: string; status: "sent" | "delivered" | "read" | "failed" }) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA_ID", changes: [{ field: "messages", value: { messaging_product: "whatsapp", statuses: [{ id: s.id, status: s.status, recipient_id: "923001234567" }] } }] }],
  };
}
