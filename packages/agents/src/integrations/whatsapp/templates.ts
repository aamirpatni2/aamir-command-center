import { and, eq, notInArray, schema, type Database } from "@acc/database";
import type { RemoteTemplate, WhatsAppClient } from "./client.js";

/** Number of {{n}} placeholders in a template body. */
export function countParams(body: string | null | undefined) {
  const nums = [...(body ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

/** Fills {{1}}, {{2}}, … exactly as WhatsApp will. */
export function renderTemplateBody(body: string | null | undefined, params: string[]) {
  return (body ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => params[Number(n) - 1] ?? m);
}

const bodyOf = (t: RemoteTemplate) => t.components?.find((c) => c.type === "BODY")?.text ?? null;

/** Mirrors the account's templates locally (Meta is the source of truth; deleted ones are removed). */
export async function syncWhatsappTemplates(db: Database, client: WhatsAppClient) {
  const res = await client.listTemplates();
  if (res.status !== "ok") return res;
  const now = new Date();
  for (const t of res.templates) {
    const body = bodyOf(t);
    const values = {
      providerId: t.id,
      name: t.name,
      language: t.language,
      category: t.category ?? null,
      status: t.status,
      body,
      bodyParams: countParams(body),
      components: (t.components ?? []) as unknown as Record<string, unknown>[],
      syncedAt: now,
    };
    await db
      .insert(schema.whatsappTemplates)
      .values(values)
      .onConflictDoUpdate({ target: [schema.whatsappTemplates.name, schema.whatsappTemplates.language], set: { ...values, updatedAt: now } });
  }
  const keep = res.templates.map((t) => t.id);
  if (keep.length) await db.delete(schema.whatsappTemplates).where(notInArray(schema.whatsappTemplates.providerId, keep));
  else await db.delete(schema.whatsappTemplates);
  return { status: "ok" as const, synced: res.templates.length, approved: res.templates.filter((t) => t.status === "APPROVED").length };
}

export async function findApprovedTemplate(db: Database, name: string, language: string) {
  const [t] = await db
    .select()
    .from(schema.whatsappTemplates)
    .where(and(eq(schema.whatsappTemplates.name, name), eq(schema.whatsappTemplates.language, language), eq(schema.whatsappTemplates.status, "APPROVED")));
  return t ?? null;
}
