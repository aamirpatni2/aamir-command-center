import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  IntegrationError, modelAvailability, OAUTH_PROVIDERS, syncWhatsappTemplates,
  type McpClientManager, type OAuthProviderId, type OAuthService, type WhatsAppClient,
} from "@acc/agents";
import type { Env } from "@acc/config";
import { asc, schema, writeAudit, type Database } from "@acc/database";
import { hasPermission } from "@acc/shared";
import { HttpError, parse } from "../lib/errors.js";
import { auditMeta } from "../lib/audit.js";
import { requireAuth } from "../plugins/auth.js";

const providerParam = z.object({ provider: z.enum(["google", "canva"]) });
const serverParam = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/) });

export interface IntegrationRouteOptions {
  db: Database;
  env: Env;
  oauth: OAuthService;
  mcp: McpClientManager;
  whatsapp: WhatsAppClient;
}

const envList = (env: Env, names: (keyof Env)[]) => names.map((name) => ({ name, set: !!env[name] }));

export async function integrationRoutes(app: FastifyInstance, opts: IntegrationRouteOptions) {
  const { db, env, oauth, mcp, whatsapp } = opts;

  app.get("/api/integrations", { preHandler: requireAuth("mcp:read") }, async (req) => {
    const model = modelAvailability(env);
    const templates = await db
      .select({ name: schema.whatsappTemplates.name, language: schema.whatsappTemplates.language, status: schema.whatsappTemplates.status, category: schema.whatsappTemplates.category, body: schema.whatsappTemplates.body, bodyParams: schema.whatsappTemplates.bodyParams, syncedAt: schema.whatsappTemplates.syncedAt })
      .from(schema.whatsappTemplates)
      .orderBy(asc(schema.whatsappTemplates.name));
    return {
      canManage: hasPermission(req.auth!.user.role, "mcp:manage"),
      redirectUri: oauth.redirectUri,
      services: [
        {
          id: "anthropic", label: "Claude (Anthropic)", kind: "api_key",
          state: env.ANTHROPIC_API_KEY ? "connected" : model.mock ? "mock" : "not_configured",
          enables: ["All agents think with Claude"], env: envList(env, ["ANTHROPIC_API_KEY"]),
          note: model.mock ? "Running on the labelled mock model (development only)." : null,
        },
        {
          id: "whatsapp", label: "WhatsApp Cloud API", kind: "api_key",
          state: env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? "connected" : env.WHATSAPP_APP_SECRET ? "partial" : "not_configured",
          enables: ["Receive messages (webhook)", "Send approved replies", "Send approved templates outside 24 h"],
          env: envList(env, ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"]),
          note: env.WHATSAPP_APP_SECRET && !env.WHATSAPP_ACCESS_TOKEN ? "Receiving works; sending needs the access token and phone number ID." : null,
        },
        {
          id: "web_search", label: "Web search (Brave or Tavily)", kind: "api_key",
          state: env.BRAVE_API_KEY || env.TAVILY_API_KEY ? "connected" : "not_configured",
          enables: ["Live, source-backed research"], env: envList(env, ["BRAVE_API_KEY", "TAVILY_API_KEY"]), note: "One of the two is enough.",
        },
        {
          id: "meta_ads", label: "Meta Ads (read-only)", kind: "api_key",
          state: env.META_ADS_ACCESS_TOKEN && env.META_AD_ACCOUNT_ID ? "connected" : "not_configured",
          enables: ["Campaign spend, clicks, leads and cost per lead on the Ads page", "ads.insights for the Marketing and Analytics agents"],
          env: envList(env, ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"]), note: "Use a system-user token with ads_read only: nothing here can change campaigns or budgets.",
        },
        {
          id: "embeddings", label: "Voyage embeddings", kind: "api_key",
          state: env.VOYAGE_API_KEY ? "connected" : "not_configured",
          enables: ["Meaning-based knowledge search (full-text works without it)"], env: envList(env, ["VOYAGE_API_KEY"]), note: null,
        },
      ],
      oauth: await Promise.all((Object.keys(OAUTH_PROVIDERS) as OAuthProviderId[]).map((p) => oauth.status(p))),
      mcp: mcp.statuses(),
      whatsappTemplates: templates,
    };
  });

  app.post("/api/integrations/:provider/connect", { preHandler: requireAuth("mcp:manage") }, async (req) => {
    const { provider } = parse(providerParam, req.params);
    try {
      const url = await oauth.start(provider, req.auth!.user.id);
      await writeAudit(db, { ...auditMeta(req), action: "integration.connect_started", entityType: "integration", metadata: { provider } });
      return { url };
    } catch (e) {
      if (e instanceof IntegrationError) throw new HttpError(400, e.code, e.message);
      throw e;
    }
  });

  /**
   * Redirect target registered with Google / Canva. No session cookie arrives here (cross-site
   * navigation, SameSite=Strict); the single-use state proves who started the flow.
   */
  app.get("/api/integrations/oauth/callback", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const q = parse(z.object({ state: z.string().max(200).optional(), code: z.string().max(2000).optional(), error: z.string().max(200).optional() }), req.query);
    const back = (params: Record<string, string>) => reply.redirect(`${env.PUBLIC_URL.replace(/\/$/, "")}/mcp?${new URLSearchParams(params)}`);
    if (q.error || !q.state || !q.code) return back({ error: q.error === "access_denied" ? "You cancelled the connection." : "The provider didn't return an authorisation code." });
    try {
      const provider = await oauth.callback(q.state, q.code);
      await writeAudit(db, { actorType: "system", action: "integration.connected", entityType: "integration", ip: req.ip, requestId: req.id, metadata: { provider } });
      return back({ connected: provider });
    } catch (e) {
      req.log.warn({ err: e }, "oauth callback failed");
      return back({ error: e instanceof IntegrationError ? e.message : "Connecting failed. Try again." });
    }
  });

  app.post("/api/integrations/:provider/disconnect", { preHandler: requireAuth("mcp:manage") }, async (req) => {
    const { provider } = parse(providerParam, req.params);
    const removed = await oauth.disconnect(provider);
    await writeAudit(db, { ...auditMeta(req), action: "integration.disconnected", entityType: "integration", metadata: { provider, removed } });
    return { disconnected: removed };
  });

  app.post("/api/integrations/:provider/test", { preHandler: requireAuth("mcp:manage") }, async (req) => {
    const provider = (req.params as { provider: string }).provider;
    if (provider === "whatsapp") return whatsapp.checkPhoneNumber();
    const { provider: p } = parse(providerParam, req.params);
    return oauth.test(p);
  });

  app.post("/api/integrations/mcp/:id/test", { preHandler: requireAuth("mcp:manage") }, async (req) => {
    const { id } = parse(serverParam, req.params);
    if (!mcp.config.servers.some((s) => s.id === id)) throw new HttpError(404, "NOT_FOUND", "MCP server not found");
    const status = await mcp.connect(id);
    await writeAudit(db, { ...auditMeta(req), action: "mcp.test", entityType: "mcp_server", metadata: { server: id, state: status.state } });
    return { server: status };
  });

  app.post("/api/whatsapp/templates/sync", { preHandler: requireAuth("mcp:read") }, async (req) => {
    let result: Awaited<ReturnType<typeof syncWhatsappTemplates>>;
    try {
      result = await syncWhatsappTemplates(db, whatsapp);
    } catch (e) {
      throw new HttpError(502, "PROVIDER_ERROR", `WhatsApp: ${(e as Error).message}`);
    }
    if (result.status === "not_configured") throw new HttpError(400, "NOT_CONFIGURED", `Set ${result.missing.join(" and ")} in .env to sync templates.`, result.missing);
    if (result.status === "error") throw new HttpError(502, "PROVIDER_ERROR", `WhatsApp: ${result.message}`);
    await writeAudit(db, { ...auditMeta(req), action: "whatsapp.templates_synced", entityType: "integration", metadata: { synced: result.synced, approved: result.approved } });
    return result;
  });
}
