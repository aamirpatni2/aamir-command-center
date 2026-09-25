import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client.js";
import { resetTestDatabase } from "./testing.js";
import { approveDocument, chunkText, searchKnowledge, unindexDocument } from "./knowledge.js";
import { knowledgeDocuments, users } from "./schema/index.js";

let h: DbHandle;
let ownerId: string;
beforeAll(async () => {
  h = createDb(await resetTestDatabase(), { max: 2 });
  ownerId = (await h.db.insert(users).values({ email: "k@x.test", name: "K", passwordHash: "x", role: "owner" }).returning())[0]!.id;
});
afterAll(async () => h?.close());

describe("chunkText", () => {
  it("keeps short text whole and splits long text with overlap", () => {
    expect(chunkText("One paragraph.")).toEqual(["One paragraph."]);
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${"word ".repeat(30)}`).join("\n\n");
    const chunks = chunkText(long, 900, 120);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 900 + 150)).toBe(true);
  });
});

describe("searchKnowledge (full-text path)", () => {
  it("finds approved chunks in English, Roman Urdu and Urdu; ignores drafts; archive removes", async () => {
    const [a] = await h.db.insert(knowledgeDocuments).values({ title: "Class timings", category: "schedule", body: "Classes hoti hain Saturday aur Sunday raat 8 baje, Zoom par." }).returning();
    const [b] = await h.db.insert(knowledgeDocuments).values({ title: "ریکارڈنگ پالیسی", category: "policy", body: "ہر کلاس کی ریکارڈنگ 30 دن تک دستیاب رہتی ہے۔" }).returning();
    await h.db.insert(knowledgeDocuments).values({ title: "Draft timings", category: "schedule", body: "Classes hoti hain Monday ko (draft)" });
    await approveDocument(h.db, a!.id, ownerId);
    await approveDocument(h.db, b!.id, ownerId);

    expect((await searchKnowledge(h.db, "classes kab hoti hain")).map((r) => r.title)).toEqual(["Class timings"]);
    expect((await searchKnowledge(h.db, "ریکارڈنگ")).map((r) => r.title)).toEqual(["ریکارڈنگ پالیسی"]);
    expect((await searchKnowledge(h.db, "Monday draft")).map((r) => r.title)).not.toContain("Draft timings");
    expect((await searchKnowledge(h.db, "zoom", { category: "policy" })).length).toBe(0);

    await unindexDocument(h.db, a!.id);
    await h.db.update(knowledgeDocuments).set({ status: "archived" });
    expect(await searchKnowledge(h.db, "classes zoom")).toEqual([]);
  });
});
