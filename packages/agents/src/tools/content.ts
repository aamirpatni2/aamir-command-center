import { z } from "zod";
import { and, desc, eq, isNull, saveContentDraft, schema, sql } from "@acc/database";
import { CONTENT_FORMATS, CONTENT_LANGUAGES, CONTENT_PLATFORMS, CONTENT_TYPES } from "@acc/shared";
import type { Tool } from "./types.js";

// Top level must be a plain object for model tool schemas; `data` lists every format and is
// then validated against the format of the chosen `type`.
const saveInput = z
  .object({
    type: z.enum(CONTENT_TYPES),
    data: z.union(Object.values(CONTENT_FORMATS) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]).describe("The content in the exact format for `type`."),
    language: z.enum(CONTENT_LANGUAGES),
    platform: z.enum(CONTENT_PLATFORMS).optional(),
    title: z.string().max(200).optional(),
    sources: z.array(z.object({ url: z.string().url(), title: z.string().max(300).optional() })).max(20).optional(),
  })
  .transform((v, ctx) => {
    const parsed = CONTENT_FORMATS[v.type].safeParse(v.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", path: ["data", ...issue.path.map(String)], message: `${v.type}: ${issue.message}` });
      return z.NEVER;
    }
    return { ...v, data: parsed.data as Record<string, unknown> };
  });

export const contentSave: Tool<z.infer<typeof saveInput>, unknown> = {
  name: "content.save",
  description:
    "Save one piece of content as a DRAFT for Aamir to review (never published). Choose the type and fill its exact format: " +
    "idea, hook, reel, script (YouTube long-form), caption, post, carousel, image_prompt, video_prompt. " +
    "Automatic checks (language, AI-isms, income/guarantee/scarcity claims, unsourced stats) run on save — read them and fix issues by saving a corrected version. " +
    "Include sources for any fact or statistic. Save each piece separately.",
  risk: "draft",
  input: saveInput as unknown as z.ZodType<z.infer<typeof saveInput>>,
  async run(input, { db, taskId }) {
    const item = await saveContentDraft(db, {
      type: input.type,
      data: input.data as Record<string, unknown>,
      language: input.language,
      platform: input.platform,
      title: input.title,
      sources: input.sources,
      sourceTaskId: taskId,
      createdBy: "agent",
    });
    const checks = (item.data as { checks: { level: string; message: string }[] }).checks;
    return { id: item.id, status: item.status, checks: checks.length ? checks : "no issues found" };
  },
};

const searchInput = z.object({
  query: z.string().max(100).optional(),
  type: z.enum(CONTENT_TYPES).optional(),
  status: z.enum(["draft", "in_review", "approved", "scheduled", "published", "rejected"]).optional(),
  limit: z.number().int().min(1).max(30).optional(),
});
export const contentSearch: Tool<z.infer<typeof searchInput>, unknown> = {
  name: "content.search",
  description: "Search existing content (drafts, approved, published) to avoid repeating topics and to reuse what worked.",
  risk: "read",
  input: searchInput,
  async run({ query, type, status, limit = 15 }, { db }) {
    const rows = await db
      .select({ id: schema.contentItems.id, type: schema.contentItems.type, title: schema.contentItems.title, status: schema.contentItems.status, language: schema.contentItems.language, publishedAt: schema.contentItems.publishedAt, createdAt: schema.contentItems.createdAt })
      .from(schema.contentItems)
      .where(
        and(
          isNull(schema.contentItems.deletedAt),
          type ? eq(schema.contentItems.type, type) : undefined,
          status ? eq(schema.contentItems.status, status) : undefined,
          query ? sql`(${schema.contentItems.title} ilike ${`%${query}%`} or ${schema.contentItems.body} ilike ${`%${query}%`})` : undefined,
        ),
      )
      .orderBy(desc(schema.contentItems.createdAt))
      .limit(limit);
    return { items: rows };
  },
};

export const CONTENT_TOOLS = [contentSave, contentSearch];
