import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { citext, id, softDelete, timestamps } from "./common.js";
import { actorType, userRole } from "./enums.js";

export const users = pgTable(
  "users",
  {
    id: id(),
    email: citext("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("viewer"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email).where(sql`${t.deletedAt} IS NULL`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    csrfToken: text("csrf_token").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("sessions_token_hash_unique").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** Append-only. The app never updates or deletes rows here. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_action_idx").on(t.action),
  ],
);
