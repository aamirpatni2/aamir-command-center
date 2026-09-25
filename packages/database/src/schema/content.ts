import { bigint, char, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common.js";
import { campaignPlatform, campaignStatus, contentLanguage, contentStatus, contentType } from "./enums.js";
import { courseBatches } from "./education.js";
import { agentTasks } from "./agents.js";

export const contentItems = pgTable(
  "content_items",
  {
    id: id(),
    type: contentType("type").notNull(),
    platform: text("platform"),
    language: contentLanguage("language").notNull().default("ur"),
    title: text("title"),
    body: text("body"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    status: contentStatus("status").notNull().default("draft"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    sourceTaskId: uuid("source_task_id").references(() => agentTasks.id),
    sources: jsonb("sources").$type<{ url: string; title?: string; retrievedAt: string }[]>().notNull().default([]),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("content_items_status_idx").on(t.status, t.scheduledFor), index("content_items_type_idx").on(t.type)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    platform: campaignPlatform("platform").notNull(),
    externalId: text("external_id"),
    name: text("name").notNull(),
    objective: text("objective"),
    status: campaignStatus("status").notNull().default("draft"),
    budgetMinor: bigint("budget_minor", { mode: "number" }),
    currency: char("currency", { length: 3 }).notNull().default("PKR"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    courseBatchId: uuid("course_batch_id").references(() => courseBatches.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex("campaigns_platform_external_unique").on(t.platform, t.externalId)],
);

/** Append-only daily metrics. */
export const campaignMetrics = pgTable(
  "campaign_metrics",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
    date: date("date").notNull(),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    clicks: bigint("clicks", { mode: "number" }).notNull().default(0),
    spendMinor: bigint("spend_minor", { mode: "number" }).notNull().default(0),
    leads: integer("leads").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("campaign_metrics_campaign_date_unique").on(t.campaignId, t.date)],
);
