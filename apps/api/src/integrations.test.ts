import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeWorkspaceTools, McpClientManager, mcpConfigSchema, OAuthService, WhatsAppClient } from "@acc/agents";
import { eq, schema } from "@acc/database";
import { createUser, login, setupTestApp, teardown, type TestContext } from "./test/helpers.js";

// ── Fake providers: Google, Canva and the WhatsApp Graph API ──────────────
interface Call { url: string; method: string; headers: Record<string, string>; body: string }
const calls: Call[] = [];
let refreshMode: "ok" | "invalid_grant" = "ok";
let tokenSeq = 0;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = String(input);
  const headers = Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const body = init.body instanceof URLSearchParams ? init.body.toString() : String(init.body ?? "");
  calls.push({ url, method: init.method ?? "GET", headers, body });
  if (url === "https://oauth2.googleapis.com/token" || url === "https://api.canva.com/rest/v1/oauth/token") {
    const form = new URLSearchParams(body);
    if (form.get("grant_type") === "refresh_token" && refreshMode === "invalid_grant") return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
    tokenSeq += 1;
    return json({ access_token: `access-${tokenSeq}`, refresh_token: form.get("grant_type") === "authorization_code" ? `refresh-${tokenSeq}` : undefined, expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/calendar.events" });
  }
  if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return json({ email: "aamir@example.com" });
  if (url.startsWith("https://api.canva.com/rest/v1/users/me/profile")) return json({ profile: { display_name: "Aamir Patni" } });
  if (url.includes("/revoke")) return new Response("", { status: 200 });
  if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) return init.method === "POST" ? json({ id: "evt1", htmlLink: "https://calendar.google.com/e/evt1" }) : json({ items: [] });
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/drafts") return json({ id: "draft1" });
  if (url.includes("/message_templates")) {
    return json({
      data: [
        { id: "t1", name: "follow_up", language: "en", status: "APPROVED", category: "MARKETING", components: [{ type: "BODY", text: "Hi {{1}}, the next batch starts on {{2}}. Reply YES to reserve a seat." }] },
        { id: "t2", name: "draft_offer", language: "en", status: "PENDING", components: [{ type: "BODY", text: "Offer" }] },
      ],
    });
  }
  if (url.endsWith("/PHONE_ID/messages")) return json({ messages: [{ id: `wamid.tpl.${calls.length}` }] });
  return json({ error: { message: `unexpected ${url}` } }, 404);
}) as typeof fetch;

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof login>>;
let admin: Awaited<ReturnType<typeof login>>;
let viewer: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  const mcp = new McpClientManager(
    mcpConfigSchema.parse({ servers: [{ id: "broken", label: "Broken", transport: "stdio", command: "no-such-mcp-command-acc", tools: { t: { risk: "read", agents: ["course"] } } }] }),
    { root: process.cwd(), connectTimeoutMs: 5_000 },
  );
  ctx = await setupTestApp(
    undefined,
    { GOOGLE_CLIENT_ID: "google-client", GOOGLE_CLIENT_SECRET: "google-secret-value", WHATSAPP_APP_SECRET: "super-secret-app-secret", PUBLIC_URL: "https://acc.example.com" },
    {
      mcp,
      oauthFetch: fakeFetch,
      whatsapp: new WhatsAppClient({ accessToken: "wa-token", phoneNumberId: "PHONE_ID", businessAccountId: "WABA_ID", graphVersion: "v21.0" }, fakeFetch),
    },
  );
  for (const role of ["owner", "admin", "viewer"] as const) await createUser(ctx, role);
  owner = await login(ctx, "owner@example.test");
  admin = await login(ctx, "admin@example.test");
  viewer = await login(ctx, "viewer@example.test");
});
afterAll(async () => ctx && teardown(ctx));
beforeEach(() => {
  refreshMode = "ok";
});

const call = (s: { headers: Record<string, string> } | null, method: "GET" | "POST", url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: s?.headers ?? {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

describe("integrations overview", () => {
  it("owner/admin only; shows which variables are set, never their values", async () => {
    expect((await call(viewer, "GET", "/api/integrations")).statusCode).toBe(403);
    const res = await call(admin, "GET", "/api/integrations");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.canManage).toBe(false);
    expect(res.body).not.toContain("super-secret-app-secret");
    expect(res.body).not.toContain("google-secret-value");
    expect(body.services.find((s: { id: string }) => s.id === "whatsapp").env).toContainEqual({ name: "WHATSAPP_APP_SECRET", set: true });
    expect(body.oauth.find((o: { id: string }) => o.id === "google")).toMatchObject({ configured: true, connection: null, redirectUri: "https://acc.example.com/api/integrations/oauth/callback" });
    expect(body.oauth.find((o: { id: string }) => o.id === "canva")).toMatchObject({ configured: false, missingEnv: ["CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET"] });
    expect(body.mcp[0]).toMatchObject({ id: "broken", state: "connecting" });
  });

  it("a failing MCP server is reported by Test, not fatal; only the owner can test", async () => {
    expect((await call(admin, "POST", "/api/integrations/mcp/broken/test")).statusCode).toBe(403);
    const res = await call(owner, "POST", "/api/integrations/mcp/broken/test");
    expect(res.statusCode).toBe(200);
    expect(res.json().server).toMatchObject({ state: "error", error: expect.any(String) });
    expect((await call(owner, "POST", "/api/integrations/mcp/nope/test")).statusCode).toBe(404);
  });
});

describe("OAuth (Google)", () => {
  let state = "";

  it("only the owner can start; the URL carries state, offline access and the exact redirect", async () => {
    expect((await call(admin, "POST", "/api/integrations/google/connect")).statusCode).toBe(403);
    const res = await call(owner, "POST", "/api/integrations/google/connect");
    const url = new URL(res.json().url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("google-client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://acc.example.com/api/integrations/oauth/callback");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.compose");
    state = url.searchParams.get("state")!;
    expect(state.length).toBeGreaterThan(30);
  });

  it("a forged state is refused; the real one connects once and stores tokens encrypted", async () => {
    const forged = await call(null, "GET", "/api/integrations/oauth/callback?state=forged&code=abc");
    expect(forged.statusCode).toBe(302);
    expect(forged.headers.location).toMatch(/^https:\/\/acc\.example\.com\/mcp\?error=/);

    const ok = await call(null, "GET", `/api/integrations/oauth/callback?state=${state}&code=auth-code-1`);
    expect(ok.headers.location).toBe("https://acc.example.com/mcp?connected=google");
    const exchange = calls.find((c) => c.url === "https://oauth2.googleapis.com/token")!;
    expect(new URLSearchParams(exchange.body).get("code")).toBe("auth-code-1");
    expect(new URLSearchParams(exchange.body).get("redirect_uri")).toBe("https://acc.example.com/api/integrations/oauth/callback");

    const [row] = await ctx.handle.db.select().from(schema.integrationConnections).where(eq(schema.integrationConnections.provider, "google"));
    expect(row).toMatchObject({ status: "connected", accountLabel: "aamir@example.com" });
    expect(row!.refreshTokenEnc).not.toContain("refresh-");
    expect(row!.accessTokenEnc).not.toContain("access-");

    const replay = await call(null, "GET", `/api/integrations/oauth/callback?state=${state}&code=auth-code-1`);
    expect(replay.headers.location).toMatch(/error=/);
    const cancelled = await call(null, "GET", "/api/integrations/oauth/callback?error=access_denied");
    expect(decodeURIComponent(cancelled.headers.location!)).toContain("cancelled");
  });

  it("refreshes expired access tokens; a revoked grant asks for a reconnect", async () => {
    await ctx.handle.db.update(schema.integrationConnections).set({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
    const before = calls.length;
    const test = await call(owner, "POST", "/api/integrations/google/test");
    expect(test.json()).toEqual({ ok: true, message: "Connected as aamir@example.com" });
    expect(calls.slice(before).some((c) => new URLSearchParams(c.body).get("grant_type") === "refresh_token")).toBe(true);

    await ctx.handle.db.update(schema.integrationConnections).set({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
    refreshMode = "invalid_grant";
    const broken = await call(owner, "POST", "/api/integrations/google/test");
    expect(broken.json()).toMatchObject({ ok: false, message: expect.stringMatching(/Reconnect/) });
    const [row] = await ctx.handle.db.select().from(schema.integrationConnections);
    expect(row!.status).toBe("error");
    // Repair for the next tests.
    await ctx.handle.db.update(schema.integrationConnections).set({ status: "connected", lastError: null, accessTokenExpiresAt: new Date(Date.now() - 1000) });
  });

  it("Gmail drafts are created (never sent) and header injection is impossible", async () => {
    const oauth = new OAuthService({ db: ctx.handle.db, env: { ACC_ENCRYPTION_KEY: "test-encryption-key-0123456789abcdef", GOOGLE_CLIENT_ID: "google-client", GOOGLE_CLIENT_SECRET: "google-secret-value" }, publicUrl: "https://acc.example.com", fetchImpl: fakeFetch });
    const draft = makeWorkspaceTools(oauth).find((t) => t.name === "google.gmail.create_draft")!;
    expect(draft.input.safeParse({ to: "a@b.co", subject: "Hi\r\nBcc: evil@x.com", body: "x" }).success).toBe(false);
    const out = await draft.run({ to: "student@example.com", subject: "Batch 3 کی تفصیل", body: "Assalam o Alaikum!" }, {} as never);
    expect(out).toMatchObject({ status: "draft_created", draftId: "draft1" });
    const raw = JSON.parse(calls.at(-1)!.body).message.raw as string;
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("To: student@example.com");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(calls.some((c) => c.url.includes("/send"))).toBe(false);
  });

  it("calendar events with invitations run only after approval", async () => {
    const [a] = await ctx.handle.db
      .insert(schema.approvals)
      .values({ actionType: "external", toolName: "google.calendar.create_event", risk: "external", title: "Class", idempotencyKey: "cal-1", payload: { summary: "Batch 3 · Class 1", start: "2026-11-01T20:00:00+05:00", end: "2026-11-01T21:30:00+05:00", attendees: ["s1@example.com"] } })
      .returning();
    const res = await call(owner, "POST", `/api/approvals/${a!.id}/approve`, {});
    expect(res.json().outcome).toMatchObject({ status: "executed", result: { eventId: "evt1" } });
    const post = calls.find((c) => c.method === "POST" && c.url.startsWith("https://www.googleapis.com/calendar"))!;
    expect(post.url).toContain("sendUpdates=all");
    expect(JSON.parse(post.body)).toMatchObject({ summary: "Batch 3 · Class 1", attendees: [{ email: "s1@example.com" }] });
  });

  it("disconnect revokes at Google and forgets the tokens", async () => {
    const res = await call(owner, "POST", "/api/integrations/google/disconnect");
    expect(res.json()).toEqual({ disconnected: true });
    expect(calls.some((c) => c.url === "https://oauth2.googleapis.com/revoke")).toBe(true);
    expect(await ctx.handle.db.select().from(schema.integrationConnections)).toHaveLength(0);
    // Tools now say so plainly instead of failing obscurely.
    const oauth = new OAuthService({ db: ctx.handle.db, env: { ACC_ENCRYPTION_KEY: "k".repeat(32), GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s" }, publicUrl: "https://x.test", fetchImpl: fakeFetch });
    const list = makeWorkspaceTools(oauth).find((t) => t.name === "google.calendar.list_events")!;
    expect(await list.run({ max: 5 }, {} as never)).toMatchObject({ status: "not_connected", message: expect.stringMatching(/isn't connected/) });
  });
});

describe("OAuth (Canva) and not-configured providers", () => {
  it("Canva isn't configured here: a clear 400 naming the variables", async () => {
    const res = await call(owner, "POST", "/api/integrations/canva/connect");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: "NOT_CONFIGURED", message: expect.stringMatching(/CANVA_CLIENT_ID and CANVA_CLIENT_SECRET/) });
  });

  it("Canva uses PKCE (S256) and HTTP Basic client auth", async () => {
    const env = { ACC_ENCRYPTION_KEY: "test-encryption-key-0123456789abcdef", CANVA_CLIENT_ID: "canva-client", CANVA_CLIENT_SECRET: "canva-secret" };
    const oauth = new OAuthService({ db: ctx.handle.db, env, publicUrl: "https://acc.example.com", fetchImpl: fakeFetch });
    const [u] = await ctx.handle.db.select().from(schema.users).limit(1);
    const url = new URL(await oauth.start("canva", u!.id));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    await oauth.callback(url.searchParams.get("state")!, "canva-code");
    const exchange = calls.filter((c) => c.url === "https://api.canva.com/rest/v1/oauth/token").at(-1)!;
    expect(exchange.headers.authorization).toBe(`Basic ${Buffer.from("canva-client:canva-secret").toString("base64")}`);
    expect(new URLSearchParams(exchange.body).get("code_verifier")).toMatch(/^[\w-]{64}$/);
    expect(new URLSearchParams(exchange.body).get("client_secret")).toBeNull();
    expect((await oauth.status("canva")).connection).toMatchObject({ accountLabel: "Aamir Patni", status: "connected" });
  });
});

describe("WhatsApp templates", () => {
  it("sync mirrors Meta; only approved templates can be sent, outside the 24h window, after approval", async () => {
    expect((await call(viewer, "POST", "/api/whatsapp/templates/sync")).statusCode).toBe(403);
    const sync = await call(admin, "POST", "/api/whatsapp/templates/sync");
    expect(sync.json()).toMatchObject({ status: "ok", synced: 2, approved: 1 });
    const list = (await call(admin, "GET", "/api/integrations")).json().whatsappTemplates;
    expect(list).toContainEqual(expect.objectContaining({ name: "follow_up", status: "APPROVED", bodyParams: 2 }));

    const db = ctx.handle.db;
    const [contact] = await db.insert(schema.contacts).values({ name: "Quiet lead", phone: "+923331234567" }).returning();
    const [conv] = await db.insert(schema.conversations).values({ contactId: contact!.id, channel: "whatsapp", externalThreadId: "tpl-1" }).returning();
    // Last customer message 3 days ago: free text would be refused, a template is allowed.
    await db.insert(schema.messages).values({ conversationId: conv!.id, direction: "inbound", body: "Fee?", status: "received", sentBy: "contact", providerMessageId: "wamid.old", createdAt: new Date(Date.now() - 3 * 86_400_000) });
    const mk = async (key: string, payload: Record<string, unknown>) =>
      (await db.insert(schema.approvals).values({ actionType: "external", toolName: "whatsapp.send_template", risk: "external", title: "Template", idempotencyKey: key, payload: { conversationId: conv!.id, language: "en", ...payload } }).returning())[0]!;

    const wrongParams = await mk("tpl-a", { template: "follow_up", params: ["Ali"] });
    expect((await call(owner, "POST", `/api/approvals/${wrongParams.id}/approve`, {})).json().outcome).toMatchObject({ status: "not_executed", code: "PRECONDITION", message: expect.stringMatching(/needs 2 parameter/) });
    const pending = await mk("tpl-b", { template: "draft_offer", params: [] });
    expect((await call(owner, "POST", `/api/approvals/${pending.id}/approve`, {})).json().outcome).toMatchObject({ status: "not_executed", code: "PRECONDITION" });

    const good = await mk("tpl-c", { template: "follow_up", params: ["Ali", "1 November"] });
    const res = await call(owner, "POST", `/api/approvals/${good.id}/approve`, {});
    expect(res.json().outcome.status).toBe("executed");
    const sent = JSON.parse(calls.filter((c) => c.url.endsWith("/PHONE_ID/messages")).at(-1)!.body);
    expect(sent).toMatchObject({ type: "template", to: "923331234567", template: { name: "follow_up", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ali" }, { type: "text", text: "1 November" }] }] } });
    const [out] = await db.select().from(schema.messages).where(eq(schema.messages.providerMessageId, res.json().approval.executionResult.providerMessageId));
    expect(out!.body).toBe("Hi Ali, the next batch starts on 1 November. Reply YES to reserve a seat.");
  });
});
