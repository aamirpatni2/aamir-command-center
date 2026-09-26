import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common.js";
import { users } from "./identity.js";

/**
 * OAuth connections (Google, Canva). Tokens are encrypted with ACC_ENCRYPTION_KEY (AES-256-GCM)
 * before they reach the database; only the account label and scopes are readable.
 */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    provider: text("provider").notNull(),
    /** e.g. the Google account email or Canva display name. */
    accountLabel: text("account_label"),
    scopes: text("scopes").array().notNull().default([]),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    /** connected | error | revoked */
    status: text("status").notNull().default("connected"),
    lastError: text("last_error"),
    connectedBy: uuid("connected_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("integration_connections_provider_unique").on(t.provider)],
);

/** Single-use OAuth `state` values (CSRF protection for the redirect back from the provider). */
export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  provider: text("provider").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id),
  /** PKCE verifier (Canva), encrypted. */
  codeVerifierEnc: text("code_verifier_enc"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** WhatsApp message templates synced from Meta. Only APPROVED ones can be sent. */
export const whatsappTemplates = pgTable(
  "whatsapp_templates",
  {
    id: id(),
    providerId: text("provider_id"),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category"),
    /** APPROVED | PENDING | REJECTED | PAUSED | DISABLED */
    status: text("status").notNull(),
    body: text("body"),
    /** Number of {{n}} placeholders in the body. */
    bodyParams: integer("body_params").notNull().default(0),
    components: jsonb("components").$type<Record<string, unknown>[]>().notNull().default([]),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex("whatsapp_templates_name_lang_unique").on(t.name, t.language), index("whatsapp_templates_status_idx").on(t.status)],
);
