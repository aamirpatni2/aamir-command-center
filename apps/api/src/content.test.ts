import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const call = (s: { headers: Record<string, string> }, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: s.headers, ...(payload !== undefined ? { payload: payload as object } : {}) });

const reel = {
  type: "reel", language: "ur-roman", platform: "facebook",
  data: {
    title: "ChatGPT vs Claude",
    durationSec: 45,
    hook: "Kya Claude, ChatGPT se behtar hai?",
    beats: [{ start: 3, end: 20, voiceover: "Main ne dono ko ek hi kaam diya.", onScreenText: "Same task" }],
    cta: "Comment mein batao",
    caption: "Aap kaunsa use karte ho?",
    hashtags: ["AIinUrdu"],
  },
};

describe("content API", () => {
  let id: string;

  it("creates a validated draft with rendered body and checks; rejects bad formats", async () => {
    const res = await call(operator, "POST", "/api/content", reel);
    expect(res.statusCode).toBe(201);
    id = res.json().item.id;
    expect(res.json().item).toMatchObject({ status: "draft", type: "reel", title: "ChatGPT vs Claude" });
    expect(res.json().item.body).toContain("HOOK (0–3s)");
    expect(res.json().item.data.checks).toEqual([]);
    const bad = await call(operator, "POST", "/api/content", { ...reel, data: { ...reel.data, beats: [] } });
    expect(bad.statusCode).toBe(400);
    expect((await call(viewer, "POST", "/api/content", reel)).statusCode).toBe(403);
  });

  it("editing re-runs checks (income claim flagged)", async () => {
    const res = await call(operator, "PATCH", `/api/content/${id}`, { body: "ChatGPT se Rs. 80,000 mahine kamao — 100% guaranteed!" });
    const codes = res.json().item.data.checks.map((c: { code: string }) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["INCOME_CLAIM", "GUARANTEE"]));
    expect(res.json().item.data.edited).toBe(true);
  });

  it("review workflow: operator submits; only owner/admin approve; invalid transitions rejected", async () => {
    expect((await call(operator, "POST", `/api/content/${id}/status`, { status: "in_review" })).json().item.status).toBe("in_review");
    expect((await call(operator, "POST", `/api/content/${id}/status`, { status: "approved" })).statusCode).toBe(403);
    expect((await call(owner, "POST", `/api/content/${id}/status`, { status: "approved", note: "Fix the claim first" })).json().item.status).toBe("approved");
    expect((await call(owner, "POST", `/api/content/${id}/status`, { status: "in_review" })).statusCode).toBe(409);
  });

  it("scheduling needs a future date; calendar shows it in its month", async () => {
    expect((await call(owner, "POST", `/api/content/${id}/status`, { status: "scheduled" })).statusCode).toBe(400);
    expect((await call(owner, "POST", `/api/content/${id}/status`, { status: "scheduled", scheduledFor: "2020-01-01T10:00:00+05:00" })).statusCode).toBe(400);
    const res = await call(owner, "POST", `/api/content/${id}/status`, { status: "scheduled", scheduledFor: "2099-03-15T19:00:00+05:00" });
    expect(res.json().item.status).toBe("scheduled");
    const cal = await call(viewer, "GET", "/api/content/calendar?month=2099-03");
    expect(cal.json().items).toEqual([expect.objectContaining({ id, status: "scheduled" })]);
    expect((await call(viewer, "GET", "/api/content/calendar?month=2099-04")).json().items).toEqual([]);
  });

  it("editing scheduled content sends it back to review and unschedules it", async () => {
    const res = await call(operator, "PATCH", `/api/content/${id}`, { body: "Kya Claude, ChatGPT se behtar hai? Main ne test kiya." });
    expect(res.json().item).toMatchObject({ status: "in_review", scheduledFor: null });
  });

  it("publish is recorded with URL and history; published items are locked", async () => {
    await call(owner, "POST", `/api/content/${id}/status`, { status: "approved" });
    const res = await call(owner, "POST", `/api/content/${id}/status`, { status: "published", publishedUrl: "https://facebook.com/reel/123" });
    expect(res.json().item.status).toBe("published");
    expect(res.json().item.publishedAt).not.toBeNull();
    expect(res.json().item.data.publishedUrl).toBe("https://facebook.com/reel/123");
    expect(res.json().item.data.history.map((h: { to: string }) => h.to)).toEqual(["in_review", "approved", "scheduled", "approved", "published"]);
    expect((await call(operator, "PATCH", `/api/content/${id}`, { body: "x" })).statusCode).toBe(409);
    expect((await call(operator, "DELETE", `/api/content/${id}`)).statusCode).toBe(404);
  });

  it("list filters by type (comma list), status and text", async () => {
    await call(operator, "POST", "/api/content", { type: "image_prompt", language: "en", data: { prompt: "A young Pakistani freelancer at a laptop, night, neon", aspectRatio: "9:16" } });
    expect((await call(viewer, "GET", "/api/content?type=image_prompt,video_prompt")).json().items).toHaveLength(1);
    expect((await call(viewer, "GET", "/api/content?status=published")).json().items).toHaveLength(1);
    expect((await call(viewer, "GET", "/api/content?q=freelancer")).json().items).toHaveLength(1);
    expect((await call(viewer, "GET", "/api/content?type=nope")).statusCode).toBe(400);
  });
});
