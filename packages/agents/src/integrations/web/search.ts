/**
 * Web search providers. Only official APIs; no scraping of search engines.
 * Brave Search API: GET https://api.search.brave.com/res/v1/web/search (X-Subscription-Token)
 * Tavily:           POST https://api.tavily.com/search (Authorization: Bearer)
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published?: string | null;
}

export interface WebSearchProvider {
  readonly id: "brave" | "tavily";
  search(query: string, opts: { count: number; freshness?: "day" | "week" | "month" | "year" }): Promise<SearchResult[]>;
}

export class WebSearchError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export class BraveSearch implements WebSearchProvider {
  readonly id = "brave" as const;
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string, opts: { count: number; freshness?: "day" | "week" | "month" | "year" }) {
    const params = new URLSearchParams({ q: query, count: String(opts.count) });
    if (opts.freshness) params.set("freshness", { day: "pd", week: "pw", month: "pm", year: "py" }[opts.freshness]);
    const res = await this.fetchImpl(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { accept: "application/json", "x-subscription-token": this.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new WebSearchError(res.status, `Brave search failed (HTTP ${res.status})`);
    const data = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string; page_age?: string; age?: string }[] } };
    return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: stripTags(r.description ?? ""), published: r.page_age ?? r.age ?? null }));
  }
}

export class TavilySearch implements WebSearchProvider {
  readonly id = "tavily" as const;
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string, opts: { count: number; freshness?: "day" | "week" | "month" | "year" }) {
    const res = await this.fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        query,
        max_results: opts.count,
        search_depth: "basic",
        ...(opts.freshness ? { time_range: opts.freshness } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new WebSearchError(res.status, `Tavily search failed (HTTP ${res.status})`);
    const data = (await res.json()) as { results?: { title: string; url: string; content?: string; published_date?: string }[] };
    return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "", published: r.published_date ?? null }));
  }
}

export function webSearchFromEnv(env: { BRAVE_API_KEY?: string; TAVILY_API_KEY?: string }, fetchImpl?: typeof fetch): WebSearchProvider | null {
  if (env.BRAVE_API_KEY) return new BraveSearch(env.BRAVE_API_KEY, fetchImpl);
  if (env.TAVILY_API_KEY) return new TavilySearch(env.TAVILY_API_KEY, fetchImpl);
  return null;
}

export function stripTags(s: string) {
  return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
