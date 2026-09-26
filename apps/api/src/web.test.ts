import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestApp, teardown, type TestContext } from "./test/helpers.js";
import { WEB_CSP } from "./routes/web.js";

let ctx: TestContext;
const dist = mkdtempSync(join(tmpdir(), "acc-web-"));

beforeAll(async () => {
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), '<!doctype html><div id="root"></div><script type="module" src="/assets/index-abc.js"></script>');
  writeFileSync(join(dist, "assets", "index-abc.js"), "console.log(1)");
  writeFileSync(join(dist, "favicon.svg"), "<svg/>");
  ctx = await setupTestApp(undefined, { WEB_DIST_DIR: dist });
});
afterAll(async () => {
  if (ctx) await teardown(ctx);
  rmSync(dist, { recursive: true, force: true });
});

const html = { accept: "text/html,application/xhtml+xml" };

describe("serving the dashboard from the API (production, one origin)", () => {
  it("the app shell has a strict CSP and is revalidated on every load", async () => {
    for (const url of ["/", "/leads", "/approvals/123?tab=history"]) {
      const res = await ctx.app.inject({ method: "GET", url, headers: html });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["content-security-policy"]).toBe(WEB_CSP);
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(res.body).toContain('<div id="root">');
    }
    expect(WEB_CSP).toContain("script-src 'self'");
    expect(WEB_CSP).not.toContain("unsafe-inline");
    expect(WEB_CSP).toContain("frame-ancestors 'none'");
  });

  it("fingerprinted assets are cached for a year; other files briefly", async () => {
    const js = await ctx.app.inject({ method: "GET", url: "/assets/index-abc.js" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const icon = await ctx.app.inject({ method: "GET", url: "/favicon.svg" });
    expect(icon.headers["cache-control"]).toBe("public, max-age=3600");
  });

  it("unknown API routes, missing assets and non-HTML requests stay 404 JSON", async () => {
    for (const [url, headers] of [["/api/nope", html], ["/assets/missing.js", html], ["/leads", { accept: "application/json" }]] as const) {
      const res = await ctx.app.inject({ method: "GET", url, headers });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    }
    expect((await ctx.app.inject({ method: "POST", url: "/leads", headers: html, payload: {} })).statusCode).toBe(404);
  });

  it("files outside the build can't be reached", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/../../package.json", headers: { accept: "*/*" } });
    expect(res.statusCode).toBe(404);
  });

  it("the API still works alongside it", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  });
});
