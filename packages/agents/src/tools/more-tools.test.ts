import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, type DbHandle } from "@acc/database";
import { OAuthService } from "../integrations/oauth/service.js";
import { makeAnalyticsTools } from "./analytics.js";
import { whatsappTemplates } from "./crm.js";
import { catalogTool, studentGet, studentSearch } from "./education.js";
import { makeWorkspaceTools } from "./workspace.js";
import { createTask, setupDb } from "../test/helpers.js";

let h: DbHandle;
let taskId: string;
const ctx = () => ({ db: h.db, taskId, runId: "00000000-0000-4000-8000-000000000001", agentId: "student" as const, toolCallId: "t" });

beforeAll(async () => {
  h = await setupDb();
  taskId = (await createTask(h)).id;
});
afterAll(async () => h?.close());

describe("education tools", () => {
  it("catalogue: says plainly when there's nothing to quote, then gives real prices", async () => {
    expect(await catalogTool.run({}, ctx())).toMatchObject({ courses: [], note: expect.stringMatching(/Do not quote/) });
    const [c] = await h.db.insert(schema.courses).values({ slug: "ai", title: "Practical AI", priceMinor: 800_000, status: "active" }).returning();
    const [b] = await h.db.insert(schema.courseBatches).values({ courseId: c!.id, name: "Batch 3", status: "enrolling", startsOn: "2099-11-01", capacity: 30 }).returning();
    const out = (await catalogTool.run({}, ctx())) as { courses: { title: string; batches: { name: string; price: string }[] }[] };
    expect(out.courses[0]).toMatchObject({ title: "Practical AI" });
    expect(JSON.stringify(out)).toContain("PKR 8,000");

    const [contact] = await h.db.insert(schema.contacts).values({ name: "Hina Tariq", phone: "+923451112233" }).returning();
    const [s] = await h.db.insert(schema.students).values({ contactId: contact!.id }).returning();
    await h.db.insert(schema.enrollments).values({ studentId: s!.id, batchId: b!.id, status: "active" });
  });

  it("student search by name, phone digits and batch; student.get shows the balance", async () => {
    const byName = (await studentSearch.run({ query: "hina" }, ctx())) as { students: { name: string; balanceDue: string; certificateEligible: boolean }[] };
    expect(byName.students).toHaveLength(1);
    expect(byName.students[0]).toMatchObject({ name: "Hina Tariq", balanceDue: "PKR 8,000", certificateEligible: false });
    expect(((await studentSearch.run({ query: "0345-111" }, ctx())) as { students: unknown[] }).students).toHaveLength(1);
    expect(((await studentSearch.run({ batchName: "batch 3" }, ctx())) as { students: unknown[] }).students).toHaveLength(1);
    expect(((await studentSearch.run({ query: "nobody" }, ctx())) as { students: unknown[] }).students).toHaveLength(0);

    const [s] = await h.db.select().from(schema.students);
    const got = (await studentGet.run({ studentId: s!.id }, ctx())) as { enrollments: { balanceDue: string; certificateStatus: string }[] };
    expect(got.enrollments[0]).toMatchObject({ balanceDue: "PKR 8,000", certificateStatus: "not_eligible" });
    expect(await studentGet.run({ studentId: "00000000-0000-4000-8000-000000000000" }, ctx())).toMatchObject({ error: expect.any(String) });
  });
});

describe("whatsapp.templates", () => {
  it("explains when nothing is synced, then lists approved templates only", async () => {
    expect(await whatsappTemplates.run({}, ctx())).toMatchObject({ templates: [], note: expect.stringMatching(/Outside the 24-hour window/) });
    await h.db.insert(schema.whatsappTemplates).values([
      { name: "follow_up", language: "en", status: "APPROVED", body: "Hi {{1}}", bodyParams: 1 },
      { name: "promo", language: "en", status: "REJECTED", body: "x" },
    ]);
    expect(await whatsappTemplates.run({}, ctx())).toEqual({ templates: [{ name: "follow_up", language: "en", category: null, body: "Hi {{1}}", params: 1 }] });
  });
});

describe("workspace tools", () => {
  const calls: string[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    const u = String(url);
    if (u.includes("/calendar/")) return Response.json({ items: [{ id: "e1", summary: "Class 1", start: { dateTime: "2026-11-01T20:00:00+05:00" }, end: { dateTime: "2026-11-01T21:30:00+05:00" }, attendees: [{}, {}] }] });
    if (u.includes("/drive/")) return Response.json({ files: [{ id: "f1", name: "Syllabus" }] });
    if (u.endsWith("/v1/designs") && init?.method === "POST") return Response.json({ design: { id: "d1", urls: { edit_url: "https://canva.com/d1/edit" } } });
    if (u.includes("/v1/designs")) return Response.json({ items: [{ id: "d0", title: "Reel cover", urls: { edit_url: "e", view_url: "v" } }] });
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
  const oauth = () => new OAuthService({ db: h.db, env: { ACC_ENCRYPTION_KEY: "k".repeat(32), GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", CANVA_CLIENT_ID: "c", CANVA_CLIENT_SECRET: "s" }, publicUrl: "https://x.test", fetchImpl: f });
  const tool = (name: string, o: OAuthService | null = oauth()) => makeWorkspaceTools(o).find((t) => t.name === name)!;

  it("hidden when not configured; clear message when not connected", async () => {
    expect(tool("google.calendar.list_events", null).available!()).toBe(false);
    expect(tool("canva.designs.list").available!()).toBe(true);
    expect(await tool("canva.designs.list").run({}, ctx())).toMatchObject({ status: "not_connected" });
  });

  it("with a connection: calendar, drive (quotes escaped) and canva", async () => {
    const future = new Date(Date.now() + 3600_000);
    const { encryptSecret } = await import("@acc/database");
    for (const provider of ["google", "canva"]) {
      await h.db.insert(schema.integrationConnections).values({ provider, accessTokenEnc: encryptSecret("tok", "k".repeat(32)), accessTokenExpiresAt: future, status: "connected" });
    }
    expect(await tool("google.calendar.list_events").run({ max: 5 }, ctx())).toEqual({ events: [{ id: "e1", summary: "Class 1", start: "2026-11-01T20:00:00+05:00", end: "2026-11-01T21:30:00+05:00", attendees: 2, link: undefined }] });
    expect(await tool("google.drive.search").run({ query: "Aamir's notes" }, ctx())).toEqual({ files: [{ id: "f1", name: "Syllabus" }] });
    const q = new URL(calls.find((c) => c.includes("/drive/"))!.split(" ")[1]!).searchParams.get("q");
    expect(q).toBe("fullText contains 'Aamir\\'s notes' and trashed = false");
    expect(await tool("canva.designs.list").run({ query: "reel" }, ctx())).toEqual({ designs: [{ id: "d0", title: "Reel cover", editUrl: "e", viewUrl: "v" }] });
    const create = tool("canva.designs.create");
    expect(create.input.safeParse({ title: "x" }).success).toBe(false);
    expect(create.input.safeParse({ title: "x", preset: "doc", width: 100, height: 100 }).success).toBe(false);
    expect(await create.run({ title: "Batch 3 post", width: 1080, height: 1350 }, ctx())).toEqual({ status: "created", designId: "d1", editUrl: "https://canva.com/d1/edit" });
  });
});

describe("analytics tools", () => {
  const [report, today, , ads] = makeAnalyticsTools(null);
  it("report by preset or dates, with the previous period; bad ranges are refused", async () => {
    const out = (await report!.run({ preset: "last_7_days" }, ctx())) as { current: { range: { days: number }; revenue: { byDay?: unknown } }; previous: unknown };
    expect(out.current.range.days).toBe(7);
    expect(out.current.revenue.byDay).toBeUndefined();
    expect(report!.input.safeParse({}).success).toBe(false);
    expect(report!.input.safeParse({ preset: "last_week", from: "2026-01-01", to: "2026-01-02" }).success).toBe(false);
    await expect(report!.run({ from: "2026-02-01", to: "2026-01-01" }, ctx())).rejects.toThrow();
  });
  it("today and ads", async () => {
    expect(await today!.run({}, ctx())).toMatchObject({ counts: expect.any(Object) });
    expect(await ads!.run({ preset: "last_7d" }, ctx())).toEqual({ status: "not_configured", missing: ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"] });
  });
});
