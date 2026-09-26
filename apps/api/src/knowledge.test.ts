import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@acc/database";
import { createUser, login, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof login>>;
let operator: Awaited<ReturnType<typeof login>>;
let viewer: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  ctx = await setupTestApp();
  await createUser(ctx, "owner");
  await createUser(ctx, "operator");
  await createUser(ctx, "viewer");
  owner = await login(ctx, "owner@example.test");
  operator = await login(ctx, "operator@example.test");
  viewer = await login(ctx, "viewer@example.test");
});
afterAll(async () => ctx && teardown(ctx));

const call = (s: { headers: Record<string, string> }, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: s.headers, ...(payload !== undefined ? { payload: payload as object } : {}) });

describe("knowledge API", () => {
  let id: string;
  it("operator drafts; draft is not searchable; only owner/admin approve", async () => {
    const res = await call(operator, "POST", "/api/knowledge", { title: "Refund policy", category: "policy", body: "Refunds within 7 days of the first class." });
    expect(res.statusCode).toBe(201);
    id = res.json().document.id;
    expect((await call(viewer, "GET", "/api/knowledge/search?q=refund")).json().results).toEqual([]);
    expect((await call(operator, "POST", `/api/knowledge/${id}/approve`)).statusCode).toBe(403);
    const ok = await call(owner, "POST", `/api/knowledge/${id}/approve`);
    expect(ok.json()).toMatchObject({ chunks: 1, document: { status: "approved" } });
    // List shows the real chunk count (correlated sub-query regression).
    expect((await call(viewer, "GET", "/api/knowledge")).json().documents[0]).toMatchObject({ chunks: 1, embedded: 0 });
    expect((await call(viewer, "GET", "/api/knowledge/search?q=refund")).json().results[0]).toMatchObject({ title: "Refund policy", match: ["text"] });
    expect((await call(owner, "POST", `/api/knowledge/${id}/approve`)).statusCode).toBe(409);
  });

  it("editing approved knowledge sends it back to draft and out of search", async () => {
    const res = await call(operator, "PATCH", `/api/knowledge/${id}`, { body: "Refunds within 14 days of the first class." });
    expect(res.json()).toMatchObject({ backToDraft: true, document: { status: "draft", version: 2 } });
    expect((await call(viewer, "GET", "/api/knowledge/search?q=refund")).json().results).toEqual([]);
    const list = await call(viewer, "GET", "/api/knowledge");
    expect(list.json()).toMatchObject({ search: { semantic: false }, documents: [expect.objectContaining({ chunks: 0 })] });
  });

  it("memory proposals: listed and decided by owner/admin only", async () => {
    const [m] = await ctx.handle.db.insert(schema.memoryItems).values({ kind: "preference", subject: "tone", content: "Roman Urdu for WhatsApp", source: "agent" }).returning();
    expect((await call(viewer, "GET", "/api/memory")).json().items).toHaveLength(1);
    expect((await call(operator, "POST", `/api/memory/${m!.id}/decide`, { decision: "approved" })).statusCode).toBe(403);
    expect((await call(owner, "POST", `/api/memory/${m!.id}/decide`, { decision: "approved" })).json().item.status).toBe("approved");
    expect((await call(owner, "POST", `/api/memory/${m!.id}/decide`, { decision: "rejected" })).statusCode).toBe(409);
  });

  it("research reports list with claim counts", async () => {
    await ctx.handle.db.insert(schema.researchReports).values({ title: "R", summary: "S", claims: [{ claim: "a", status: "verified", sources: [{ url: "https://x.test" }] }, { claim: "b", status: "unverified", sources: [] }] });
    const res = await call(viewer, "GET", "/api/research");
    expect(res.json().reports[0].counts).toEqual({ verified: 1, unverified: 1, contradicted: 0 });
  });
});
