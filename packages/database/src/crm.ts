/**
 * CRM domain logic shared by the API (webhooks, lead routes) and agent tools.
 */
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { detectSignals, normalizePhone, scoreLead, type LeadSignals } from "@acc/shared";
import type { Database } from "./client.js";
import { contacts, conversations, leads, messages } from "./schema/index.js";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

const OPEN_LEAD = and(isNull(leads.deletedAt), notInArray(leads.status, ["won", "lost"]));

export class InvalidPhoneError extends Error {
  readonly code = "INVALID_PHONE";
}

export async function upsertContactByPhone(
  db: DbOrTx,
  input: { phone: string; name?: string | null; email?: string | null; whatsappId?: string | null },
) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new InvalidPhoneError(`"${input.phone}" is not a valid phone number`);
  const [existing] = await db.select().from(contacts).where(and(eq(contacts.phone, phone), isNull(contacts.deletedAt)));
  if (existing) {
    const patch: Partial<typeof contacts.$inferInsert> = {};
    if (!existing.name && input.name) patch.name = input.name;
    if (!existing.email && input.email) patch.email = input.email;
    if (!existing.whatsappId && input.whatsappId) patch.whatsappId = input.whatsappId;
    if (Object.keys(patch).length) {
      const [updated] = await db.update(contacts).set(patch).where(eq(contacts.id, existing.id)).returning();
      return { contact: updated!, created: false };
    }
    return { contact: existing, created: false };
  }
  const [created] = await db
    .insert(contacts)
    .values({ phone, name: input.name ?? null, email: input.email ?? null, whatsappId: input.whatsappId ?? null })
    .onConflictDoNothing()
    .returning();
  if (created) return { contact: created, created: true };
  // Lost a race with a concurrent insert: read the winner.
  const [winner] = await db.select().from(contacts).where(and(eq(contacts.phone, phone), isNull(contacts.deletedAt)));
  return { contact: winner!, created: false };
}

/** One open lead per contact (enforced by a partial unique index). */
export async function getOrCreateOpenLead(db: DbOrTx, contactId: string, source: string, notes?: string | null) {
  const [open] = await db.select().from(leads).where(and(eq(leads.contactId, contactId), OPEN_LEAD));
  if (open) return { lead: open, created: false };
  const [created] = await db.insert(leads).values({ contactId, source, notes: notes ?? null }).onConflictDoNothing().returning();
  if (created) return { lead: created, created: true };
  const [winner] = await db.select().from(leads).where(and(eq(leads.contactId, contactId), OPEN_LEAD));
  return { lead: winner!, created: false };
}

/** Recomputes score + reasons from the lead's signals using the documented rules. */
export async function recalculateLeadScore(db: DbOrTx, leadId: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) return null;
  const result = scoreLead({
    signals: lead.signals,
    source: lead.source,
    inboundMessageCount: lead.inboundMessageCount,
    lastInboundAt: lead.lastInboundAt,
  });
  const [updated] = await db
    .update(leads)
    .set({ score: result.score, scoreReasons: result.reasons })
    .where(eq(leads.id, leadId))
    .returning();
  return { lead: updated!, band: result.band };
}

export async function mergeLeadSignals(db: DbOrTx, leadId: string, add: LeadSignals) {
  if (!Object.keys(add).length) return;
  await db
    .update(leads)
    .set({ signals: sql`${leads.signals} || ${JSON.stringify(add)}::jsonb` })
    .where(eq(leads.id, leadId));
}

export interface InboundMessage {
  channel: "whatsapp";
  /** Sender id on the channel (WhatsApp wa_id, digits only). */
  from: string;
  profileName?: string | null;
  providerMessageId: string;
  text: string | null;
  media?: Record<string, unknown>[] | null;
  sentAt: Date;
}

/**
 * Stores an inbound message idempotently and updates contact, conversation and lead.
 * Returns `duplicate: true` (and changes nothing) if the provider message id was seen before.
 */
export async function ingestInboundMessage(db: Database, m: InboundMessage) {
  return db.transaction(async (tx) => {
    const { contact } = await upsertContactByPhone(tx, { phone: `+${m.from.replace(/\D/g, "")}`, name: m.profileName, whatsappId: m.from });

    const [conversation] = await tx
      .insert(conversations)
      .values({ contactId: contact.id, channel: m.channel, externalThreadId: m.from, lastMessageAt: m.sentAt, status: "open" })
      .onConflictDoUpdate({
        target: [conversations.channel, conversations.externalThreadId],
        set: { lastMessageAt: sql`greatest(${conversations.lastMessageAt}, excluded.last_message_at)`, status: "open" },
      })
      .returning();

    const [message] = await tx
      .insert(messages)
      .values({
        conversationId: conversation!.id,
        direction: "inbound",
        providerMessageId: m.providerMessageId,
        body: m.text,
        media: m.media ?? null,
        status: "received",
        sentBy: "contact",
        createdAt: m.sentAt,
      })
      .onConflictDoNothing({ target: messages.providerMessageId })
      .returning();
    if (!message) return { duplicate: true as const, contact, conversation: conversation!, message: null, lead: null, leadCreated: false };

    const { lead, created } = await getOrCreateOpenLead(tx, contact.id, "whatsapp");
    await tx
      .update(leads)
      .set({
        inboundMessageCount: sql`${leads.inboundMessageCount} + 1`,
        lastInboundAt: sql`greatest(${leads.lastInboundAt}, ${m.sentAt.toISOString()}::timestamptz)`,
        ...(lead.status === "nurture" ? { status: "contacted" as const } : {}),
      })
      .where(eq(leads.id, lead.id));
    if (m.text) await mergeLeadSignals(tx, lead.id, detectSignals(m.text));
    const scored = await recalculateLeadScore(tx, lead.id);
    return { duplicate: false as const, contact, conversation: conversation!, message, lead: scored!.lead, band: scored!.band, leadCreated: created };
  });
}

const STATUS_ORDER = ["draft", "pending_approval", "sent", "delivered", "read"] as const;

/** Delivery receipts only move a message forward (sent → delivered → read), or to failed. */
export async function applyOutboundStatus(db: DbOrTx, providerMessageId: string, status: "sent" | "delivered" | "read" | "failed") {
  const [msg] = await db.select().from(messages).where(eq(messages.providerMessageId, providerMessageId));
  if (!msg) return false;
  const current = STATUS_ORDER.indexOf(msg.status as (typeof STATUS_ORDER)[number]);
  const next = status === "failed" ? Infinity : STATUS_ORDER.indexOf(status);
  if (status !== "failed" && next <= current) return false;
  await db.update(messages).set({ status }).where(eq(messages.id, msg.id));
  return true;
}
