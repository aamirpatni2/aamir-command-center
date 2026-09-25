import { describe, expect, it } from "vitest";
import { BraveSearch, TavilySearch, webSearchFromEnv } from "./search.js";
import { assertPublicUrl, FetchBlockedError, fetchPage, htmlToText } from "./fetch.js";
import { VoyageEmbedder } from "../embeddings/voyage.js";

function capture(response: unknown, init: ResponseInit = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL, i: RequestInit = {}) => {
    calls.push({ url: String(url), init: i });
    return new Response(typeof response === "string" ? response : JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" }, ...init });
  }) as typeof fetch;
  return { fn, calls };
}
const publicDns = async () => ["93.184.216.34"];

describe("web search providers (contract)", () => {
  it("Brave: key header, freshness mapping, result mapping", async () => {
    const c = capture({ web: { results: [{ title: "Claude <strong>news</strong>", url: "https://anthropic.com/news/x", description: "New <strong>model</strong>", page_age: "2026-09-25" }] } });
    const r = await new BraveSearch("brave-key", c.fn).search("claude news", { count: 5, freshness: "day" });
    expect(c.calls[0]!.url).toBe("https://api.search.brave.com/res/v1/web/search?q=claude+news&count=5&freshness=pd");
    expect(new Headers(c.calls[0]!.init.headers).get("x-subscription-token")).toBe("brave-key");
    expect(r).toEqual([{ title: "Claude <strong>news</strong>", url: "https://anthropic.com/news/x", snippet: "New model", published: "2026-09-25" }]);
  });
  it("Tavily: bearer auth and JSON body", async () => {
    const c = capture({ results: [{ title: "T", url: "https://example.com/a", content: "snippet", published_date: "2026-09-24" }] });
    const r = await new TavilySearch("tvly-key", c.fn).search("mcp", { count: 3, freshness: "week" });
    expect(c.calls[0]!.url).toBe("https://api.tavily.com/search");
    expect(new Headers(c.calls[0]!.init.headers).get("authorization")).toBe("Bearer tvly-key");
    expect(JSON.parse(String(c.calls[0]!.init.body))).toEqual({ query: "mcp", max_results: 3, search_depth: "basic", time_range: "week" });
    expect(r[0]).toMatchObject({ url: "https://example.com/a", snippet: "snippet" });
  });
  it("prefers Brave, then Tavily, else null", () => {
    expect(webSearchFromEnv({ BRAVE_API_KEY: "b", TAVILY_API_KEY: "t" })!.id).toBe("brave");
    expect(webSearchFromEnv({ TAVILY_API_KEY: "t" })!.id).toBe("tavily");
    expect(webSearchFromEnv({})).toBeNull();
  });
});

describe("safe fetch (SSRF protection)", () => {
  it.each([
    ["file:///etc/passwd", "http\\(s\\)"],
    ["http://localhost:4000/api/health", "Local"],
    ["http://127.0.0.1/", "Private"],
    ["http://10.0.0.5/admin", "Private"],
    ["http://169.254.169.254/latest/meta-data", "Private"],
    ["http://[::1]/", "Private"],
    ["https://user:pass@example.com/", "credentials"],
  ])("blocks %s", async (url, msg) => {
    await expect(assertPublicUrl(url, publicDns)).rejects.toThrow(new RegExp(msg));
  });
  it("blocks public names that resolve to private IPs (DNS rebinding style)", async () => {
    await expect(assertPublicUrl("https://evil.example.com/", async () => ["10.1.2.3"])).rejects.toBeInstanceOf(FetchBlockedError);
  });
  it("re-checks redirects", async () => {
    const fn = (async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } })) as unknown as typeof fetch;
    await expect(fetchPage("https://example.com/", { fetchImpl: fn, resolve: async (h) => (h === "example.com" ? ["93.184.216.34"] : ["127.0.0.1"]) })).rejects.toThrow(/Private/);
  });
  it("extracts readable text and title; rejects binaries", async () => {
    const html = "<html><head><title>AI &amp; You</title><script>alert(1)</script></head><body><nav>menu</nav><h1>Hello</h1><p>Claude is <b>here</b>.</p></body></html>";
    expect(htmlToText(html)).toEqual({ title: "AI & You", text: "Hello\n\nClaude is here ." });
    const ok = (async () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch;
    const page = await fetchPage("https://example.com/", { fetchImpl: ok, resolve: publicDns });
    expect(page).toMatchObject({ title: "AI & You", truncated: false });
    const pdf = (async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } })) as unknown as typeof fetch;
    await expect(fetchPage("https://example.com/x.pdf", { fetchImpl: pdf, resolve: publicDns })).rejects.toThrow(/content type/);
  });
});

describe("Voyage embeddings (contract)", () => {
  it("sends model, input_type and 1024 dimensions; returns vectors in order", async () => {
    const c = capture({ data: [{ embedding: [0.2], index: 1 }, { embedding: [0.1], index: 0 }] });
    const v = await new VoyageEmbedder("voy-key", "voyage-3.5", 1024, c.fn).embed(["a", "b"], "document");
    expect(v).toEqual([[0.1], [0.2]]);
    expect(JSON.parse(String(c.calls[0]!.init.body))).toEqual({ input: ["a", "b"], model: "voyage-3.5", input_type: "document", output_dimension: 1024 });
    expect(new Headers(c.calls[0]!.init.headers).get("authorization")).toBe("Bearer voy-key");
  });
});
