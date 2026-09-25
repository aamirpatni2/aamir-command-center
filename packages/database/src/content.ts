import { checkContent, renderContent, type ContentType } from "@acc/shared";
import type { DbOrTx } from "./crm.js";
import { contentItems } from "./schema/index.js";

export interface ContentDraftInput {
  type: ContentType;
  data: Record<string, unknown>;
  language: "ur" | "ur-roman" | "en";
  platform?: string | null;
  title?: string | null;
  sources?: { url: string; title?: string }[];
  sourceTaskId?: string | null;
  createdBy?: "agent" | "user";
}

export function contentText(type: ContentType, data: Record<string, unknown>) {
  return renderContent(type, data);
}

export function runContentChecks(type: ContentType, language: ContentDraftInput["language"], text: string, data: Record<string, unknown>, hasSources: boolean) {
  const hook = typeof data.hook === "string" ? data.hook : type === "hook" && typeof data.text === "string" ? data.text : undefined;
  return checkContent({ type, language, text, hook, hasSources });
}

/** Saves a validated content draft with its rendered body and automatic checks. */
export async function saveContentDraft(db: DbOrTx, input: ContentDraftInput) {
  const body = contentText(input.type, input.data);
  const sources = (input.sources ?? []).map((s) => ({ url: s.url, title: s.title, retrievedAt: new Date().toISOString() }));
  const checks = runContentChecks(input.type, input.language, body, input.data, sources.length > 0);
  const title = input.title ?? (typeof input.data.title === "string" ? input.data.title : body.split("\n")[0]!.slice(0, 120));
  const [item] = await db
    .insert(contentItems)
    .values({
      type: input.type,
      platform: input.platform ?? null,
      language: input.language,
      title,
      body,
      data: { format: input.data, checks, createdBy: input.createdBy ?? "user", edited: false },
      status: "draft",
      sourceTaskId: input.sourceTaskId ?? null,
      sources,
    })
    .returning();
  return item!;
}
