import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { citext, id, softDelete, timestamps } from "./common.js";
import { channel, conversationStatus, leadStatus, messageDirection, messageSender, messageStatus } from "./enums.js";
import { users } from "./identity.js";
import { courses } from "./education.js";

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    name: text("name"),
    /** E.164, e.g. +923001234567 */
    phone: text("phone"),
    email: citext("email"),
    whatsappId: text("whatsapp_id"),
    locale: text("locale").default("ur-PK"),
    city: text("city"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("contacts_phone_unique").on(t.phone).where(sql`${t.deletedAt} IS NULL AND ${t.phone} IS NOT NULL`),
    index("contacts_email_idx").on(t.email),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id),
    source: text("source").notNull().default("unknown"),
    status: leadStatus("status").notNull().default("new"),
    score: integer("score").notNull().default(0),
    scoreReasons: jsonb("score_reasons").$type<{ rule: string; points: number }[]>().notNull().default([]),
    interestedCourseId: uuid("interested_course_id").references(() => courses.id),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    notes: text("notes"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("leads_status_idx").on(t.status),
    index("leads_follow_up_idx").on(t.nextFollowUpAt),
    index("leads_contact_idx").on(t.contactId),
    // One open lead per contact: duplicate enquiries merge into the existing lead.
    uniqueIndex("leads_one_open_per_contact")
      .on(t.contactId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.status} NOT IN ('won', 'lost')`),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id),
    channel: channel("channel").notNull(),
    externalThreadId: text("external_thread_id"),
    status: conversationStatus("status").notNull().default("open"),
    intent: text("intent"),
    assignedAgent: text("assigned_agent"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("conversations_channel_thread_unique").on(t.channel, t.externalThreadId),
    index("conversations_contact_idx").on(t.contactId),
    index("conversations_last_message_idx").on(t.lastMessageAt),
  ],
);

/** Append-only message log. Status changes are the only allowed update. */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id),
    direction: messageDirection("direction").notNull(),
    providerMessageId: text("provider_message_id"),
    body: text("body"),
    media: jsonb("media").$type<Record<string, unknown>[]>(),
    status: messageStatus("status").notNull(),
    sentBy: messageSender("sent_by").notNull(),
    ...timestamps,
  },
  (t) => [
    // Stops duplicate webhook deliveries from creating duplicate messages.
    uniqueIndex("messages_provider_id_unique").on(t.providerMessageId),
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
  ],
);
