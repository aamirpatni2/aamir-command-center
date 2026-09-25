/**
 * Internal tools backed by our own database. Real implementations — no mocks.
 */
import { z } from "zod";
import { and, desc, eq, ilike, isNull, or, schema, sql } from "@acc/database";
import type { Tool } from "./types.js";

/** Keyword search over APPROVED knowledge only. Vector search replaces this in Milestone 8. */
const kbSearchInput = z.object({
  query: z.string().min(1).max(300),
  category: z.enum(["course", "pricing", "schedule", "policy", "faq", "teaching", "business", "marketing", "brand"]).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

export const kbSearch: Tool<z.infer<typeof kbSearchInput>, unknown> = {
  name: "kb.search",
  description:
    "Search Aamir's approved business knowledge (courses, pricing, schedules, policies, FAQs, brand). " +
    "Only approved documents are returned. If nothing is found, say so — never invent prices, dates or policies.",
  risk: "read",
  input: kbSearchInput,
  async run({ query, category, limit = 5 }, { db }) {
    const words = query.split(/\s+/).filter((w) => w.length > 2).slice(0, 8);
    const match = words.length
      ? or(...words.flatMap((w) => [ilike(schema.knowledgeDocuments.title, `%${w}%`), ilike(schema.knowledgeDocuments.body, `%${w}%`)]))
      : undefined;
    const rows = await db
      .select({
        id: schema.knowledgeDocuments.id,
        title: schema.knowledgeDocuments.title,
        category: schema.knowledgeDocuments.category,
        body: sql<string>`left(${schema.knowledgeDocuments.body}, 1500)`,
        approvedAt: schema.knowledgeDocuments.approvedAt,
      })
      .from(schema.knowledgeDocuments)
      .where(
        and(
          eq(schema.knowledgeDocuments.status, "approved"),
          isNull(schema.knowledgeDocuments.deletedAt),
          category ? eq(schema.knowledgeDocuments.category, category) : undefined,
          match,
        ),
      )
      .orderBy(desc(schema.knowledgeDocuments.approvedAt))
      .limit(limit);
    return { results: rows, note: rows.length ? undefined : "No approved knowledge matched. Do not guess." };
  },
};

/** Agents can PROPOSE long-term memory; only a human approves it into trusted memory. */
export const memoryPropose: Tool<{ kind: "fact" | "preference" | "decision" | "event"; subject: string; content: string; confidence?: number }, unknown> = {
  name: "memory.propose",
  description:
    "Propose something worth remembering long-term (a fact, preference, decision or event). " +
    "It is stored as 'proposed' and is not trusted until Aamir approves it.",
  risk: "draft",
  input: z.object({
    kind: z.enum(["fact", "preference", "decision", "event"]),
    subject: z.string().min(1).max(120),
    content: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1).optional(),
  }),
  async run(input, { db, runId }) {
    const [row] = await db
      .insert(schema.memoryItems)
      .values({ ...input, source: "agent", status: "proposed", sourceRunId: runId })
      .returning({ id: schema.memoryItems.id });
    return { id: row!.id, status: "proposed" };
  },
};

export const INTERNAL_TOOLS = [kbSearch, memoryPropose];
