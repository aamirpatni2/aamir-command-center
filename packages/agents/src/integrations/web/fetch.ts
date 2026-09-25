/**
 * Safe page fetcher for research. Guards against SSRF: http(s) only, no credentials in URLs,
 * public addresses only (resolved via DNS before connecting), size and time limits, redirects re-checked.
 * Page text is returned as untrusted data.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class FetchBlockedError extends Error {}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("::ffff:127.") || v6.startsWith("::ffff:10.") || v6.startsWith("::ffff:192.168.");
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

export async function assertPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchBlockedError("Invalid URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new FetchBlockedError("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new FetchBlockedError("URLs with credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new FetchBlockedError("Local hosts are not allowed");
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (!addresses.length) throw new FetchBlockedError("Host could not be resolved");
  if (addresses.some(isPrivateAddress)) throw new FetchBlockedError("Private or internal addresses are not allowed");
  return url;
}

export function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const text = html
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .replace(/(\S)\n(\S)/g, "$1\n\n$2")
    .trim();
  return { title: title ? htmlToText(title).text : null, text };
}

export async function fetchPage(
  raw: string,
  opts: { fetchImpl?: typeof fetch; resolve?: Resolver; maxChars?: number } = {},
): Promise<{ url: string; title: string | null; text: string; truncated: boolean; contentType: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current, opts.resolve);
    const res = await fetchImpl(url, {
      redirect: "manual",
      headers: { "user-agent": "AamirCommandCenter-Research/1.0 (+research agent)", accept: "text/html,text/plain,application/json;q=0.8" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/json|application\/xhtml/.test(contentType)) throw new FetchBlockedError(`Unsupported content type: ${contentType || "unknown"}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new FetchBlockedError("Page too large");
    const buf = Buffer.from(await res.arrayBuffer());
    const body = buf.subarray(0, MAX_BYTES).toString("utf8");
    const { title, text } = contentType.includes("html") ? htmlToText(body) : { title: null, text: body };
    const maxChars = opts.maxChars ?? 15_000;
    return { url: url.toString(), title, text: text.slice(0, maxChars), truncated: text.length > maxChars, contentType };
  }
  throw new FetchBlockedError("Too many redirects");
}
