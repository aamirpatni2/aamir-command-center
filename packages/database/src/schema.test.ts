import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client.js";
import { resetTestDatabase } from "./testing.js";
import { contacts, conversations, leads, messages, users } from "./schema/index.js";

let h: DbHandle;

beforeAll(async () => {
  h = createDb(await resetTestDatabase(), { max: 2 });
});
afterAll(async () => h?.close());

const pgCode = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;

describe("schema business rules", () => {
  it("creates all expected tables", async () => {
    const rows = await h.sql<{ table_name: string }[]>`select table_name from information_schema.tables where table_schema = 'public'`;
    const names = rows.map((r) => r.table_name);
    for (const t of [
      "users", "sessions", "leads", "contacts", "conversations", "messages", "students", "courses", "course_batches",
      "enrollments", "classes", "assignments", "payments", "content_items", "campaigns", "campaign_metrics",
      "agent_tasks", "agent_runs", "agent_messages", "approvals", "knowledge_documents", "knowledge_chunks",
      "automation_rules", "audit_logs", "agent_steps", "memory_items", "assignment_submissions",
    ]) expect(names).toContain(t);
  });

  it("user emails are unique case-insensitively", async () => {
    await h.db.insert(users).values({ email: "a@x.test", name: "A", passwordHash: "x" });
    await expect(h.db.insert(users).values({ email: "A@X.test", name: "B", passwordHash: "x" })).rejects.toSatisfy((e) => pgCode(e) === "23505");
  });

  it("duplicate lead: only one open lead per contact", async () => {
    const [c] = await h.db.insert(contacts).values({ name: "Lead", phone: "+923001234567" }).returning();
    await h.db.insert(leads).values({ contactId: c!.id, source: "whatsapp" });
    await expect(h.db.insert(leads).values({ contactId: c!.id, source: "facebook" })).rejects.toSatisfy((e) => pgCode(e) === "23505");
    // A closed (won/lost) lead doesn't block a new enquiry.
    const [c2] = await h.db.insert(contacts).values({ name: "Returning", phone: "+923009999999" }).returning();
    await h.db.insert(leads).values({ contactId: c2!.id, status: "lost" });
    await expect(h.db.insert(leads).values({ contactId: c2!.id })).resolves.toBeDefined();
  });

  it("duplicate contact phone is rejected", async () => {
    await expect(h.db.insert(contacts).values({ phone: "+923001234567" })).rejects.toSatisfy((e) => pgCode(e) === "23505");
  });

  it("duplicate webhook message (same provider id) is rejected", async () => {
    const [c] = await h.db.insert(contacts).values({ phone: "+923005550000" }).returning();
    const [conv] = await h.db.insert(conversations).values({ contactId: c!.id, channel: "whatsapp", externalThreadId: "t1" }).returning();
    const msg = { conversationId: conv!.id, direction: "inbound" as const, providerMessageId: "wamid.ABC", body: "Salam", status: "received" as const, sentBy: "contact" as const };
    await h.db.insert(messages).values(msg);
    await expect(h.db.insert(messages).values(msg)).rejects.toSatisfy((e) => pgCode(e) === "23505");
    // Idempotent path used by the webhook handler:
    const res = await h.db.insert(messages).values(msg).onConflictDoNothing().returning();
    expect(res).toHaveLength(0);
  });

  it("pgvector column is available", async () => {
    const rows = await h.sql`select atttypid::regtype::text as t from pg_attribute where attrelid = 'knowledge_chunks'::regclass and attname = 'embedding'`;
    expect(rows[0]?.t).toBe("vector");
  });
});
