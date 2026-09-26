/**
 * OAuth 2.0 connections for Google Workspace and Canva Connect.
 *
 * - The owner starts the flow; a random, single-use `state` (10 minutes) is stored server-side.
 *   The callback is a cross-site redirect, so the SameSite=Strict session cookie isn't sent:
 *   the stored state is what authenticates it.
 * - Canva requires PKCE (S256); the verifier is stored encrypted with the state.
 * - Tokens are encrypted at rest (AES-256-GCM) and refreshed automatically; a revoked grant marks
 *   the connection as needing a reconnect instead of failing silently.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, decryptSecret, encryptSecret, eq, gt, schema, sql, type Database } from "@acc/database";

export type OAuthProviderId = "google" | "canva";

export interface OAuthProvider {
  id: OAuthProviderId;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  scopes: string[];
  pkce: boolean;
  /** Client credentials go in an HTTP Basic header (Canva) or the form body (Google). */
  basicAuth: boolean;
  env: { clientId: string; clientSecret: string };
  extraAuthorizeParams?: Record<string, string>;
  account: (accessToken: string, f: typeof fetch) => Promise<string | null>;
  /** What the connection enables, shown in the UI. */
  enables: string[];
  docs: string;
}

export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProvider> = {
  google: {
    id: "google",
    label: "Google Workspace",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
    pkce: false,
    basicAuth: false,
    env: { clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET" },
    extraAuthorizeParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    account: async (token, f) => {
      const r = await f("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      return r.ok ? (((await r.json()) as { email?: string }).email ?? null) : null;
    },
    enables: ["Calendar: read events; create events (after approval)", "Drive: search and read files (read-only)", "Gmail: create drafts in your mailbox (never sends)"],
    docs: "Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application). Enable the Calendar, Drive and Gmail APIs.",
  },
  canva: {
    id: "canva",
    label: "Canva",
    authorizeUrl: "https://www.canva.com/api/oauth/authorize",
    tokenUrl: "https://api.canva.com/rest/v1/oauth/token",
    revokeUrl: "https://api.canva.com/rest/v1/oauth/revoke",
    scopes: ["profile:read", "design:meta:read", "design:content:read", "design:content:write"],
    pkce: true,
    basicAuth: true,
    env: { clientId: "CANVA_CLIENT_ID", clientSecret: "CANVA_CLIENT_SECRET" },
    account: async (token, f) => {
      const r = await f("https://api.canva.com/rest/v1/users/me/profile", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      return r.ok ? (((await r.json()) as { profile?: { display_name?: string } }).profile?.display_name ?? null) : null;
    },
    enables: ["Find your existing designs", "Create new blank designs for creatives (opens in Canva for editing)"],
    docs: "Canva Developers → Your integrations → Create an integration (Connect API). Add the redirect URL and the scopes listed here.",
  },
};

export class IntegrationError extends Error {
  constructor(
    readonly code: "NOT_CONFIGURED" | "NOT_CONNECTED" | "INVALID_STATE" | "PROVIDER_ERROR",
    message: string,
  ) {
    super(message);
  }
}

export interface OAuthServiceOptions {
  db: Database;
  env: { ACC_ENCRYPTION_KEY: string; [key: string]: unknown };
  /** Public base URL of the dashboard, e.g. https://acc.example.com (the callback goes through /api). */
  publicUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export class OAuthService {
  private readonly f: typeof fetch;
  constructor(private readonly o: OAuthServiceOptions) {
    this.f = o.fetchImpl ?? fetch;
  }

  get redirectUri() {
    return `${this.o.publicUrl.replace(/\/$/, "")}/api/integrations/oauth/callback`;
  }

  private secret(name: string): string | undefined {
    const v = this.o.env[name];
    return typeof v === "string" && v.trim() !== "" ? v : undefined;
  }

  missingEnv(id: OAuthProviderId) {
    const p = OAUTH_PROVIDERS[id];
    return [p.env.clientId, p.env.clientSecret].filter((k) => !this.secret(k));
  }

  private creds(id: OAuthProviderId) {
    const p = OAUTH_PROVIDERS[id];
    const missing = this.missingEnv(id);
    if (missing.length) throw new IntegrationError("NOT_CONFIGURED", `${p.label} isn't configured. Set ${missing.join(" and ")} in .env.`);
    return { clientId: this.secret(p.env.clientId)!, clientSecret: this.secret(p.env.clientSecret)! };
  }

  private enc = (v: string) => encryptSecret(v, this.o.env.ACC_ENCRYPTION_KEY);
  private dec = (v: string) => decryptSecret(v, this.o.env.ACC_ENCRYPTION_KEY);
  private now = () => this.o.now?.() ?? new Date();

  async connection(id: OAuthProviderId) {
    const [row] = await this.o.db.select().from(schema.integrationConnections).where(eq(schema.integrationConnections.provider, id));
    return row ?? null;
  }

  /** Public status for the UI: never includes tokens. */
  async status(id: OAuthProviderId) {
    const p = OAUTH_PROVIDERS[id];
    const c = await this.connection(id);
    return {
      id,
      label: p.label,
      configured: this.missingEnv(id).length === 0,
      missingEnv: this.missingEnv(id),
      env: [p.env.clientId, p.env.clientSecret].map((name) => ({ name, set: !!this.secret(name) })),
      redirectUri: this.redirectUri,
      scopes: p.scopes,
      enables: p.enables,
      docs: p.docs,
      connection: c ? { status: c.status, accountLabel: c.accountLabel, scopes: c.scopes, lastError: c.lastError, connectedAt: c.createdAt } : null,
    };
  }

  /** Starts the flow: returns the provider URL to send the owner to. */
  async start(id: OAuthProviderId, userId: string): Promise<string> {
    const p = OAUTH_PROVIDERS[id];
    const { clientId } = this.creds(id);
    const state = b64url(randomBytes(32));
    const verifier = p.pkce ? b64url(randomBytes(48)) : null;
    await this.o.db.delete(schema.oauthStates).where(sql`${schema.oauthStates.expiresAt} < now()`);
    await this.o.db.insert(schema.oauthStates).values({
      state,
      provider: id,
      userId,
      codeVerifierEnc: verifier ? this.enc(verifier) : null,
      expiresAt: new Date(this.now().getTime() + 10 * 60_000),
    });
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: this.redirectUri,
      scope: p.scopes.join(" "),
      state,
      ...(verifier ? { code_challenge: b64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256" } : {}),
      ...p.extraAuthorizeParams,
    });
    return `${p.authorizeUrl}?${params}`;
  }

  private async tokenRequest(id: OAuthProviderId, form: Record<string, string>) {
    const p = OAUTH_PROVIDERS[id];
    const { clientId, clientSecret } = this.creds(id);
    const body = new URLSearchParams(p.basicAuth ? form : { ...form, client_id: clientId, client_secret: clientSecret });
    const res = await this.f(p.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(p.basicAuth ? { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      const err = new IntegrationError("PROVIDER_ERROR", `${p.label}: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`);
      (err as IntegrationError & { oauthError?: string }).oauthError = data.error;
      throw err;
    }
    return data;
  }

  /** Handles the redirect back. The state is consumed exactly once. Returns the provider id. */
  async callback(state: string, code: string): Promise<OAuthProviderId> {
    const [row] = await this.o.db
      .delete(schema.oauthStates)
      .where(and(eq(schema.oauthStates.state, state), gt(schema.oauthStates.expiresAt, this.now())))
      .returning();
    if (!row) throw new IntegrationError("INVALID_STATE", "This sign-in link is invalid or has expired. Start the connection again.");
    const id = row.provider as OAuthProviderId;
    const t = await this.tokenRequest(id, {
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      ...(row.codeVerifierEnc ? { code_verifier: this.dec(row.codeVerifierEnc) } : {}),
    });
    const account = await OAUTH_PROVIDERS[id].account(t.access_token!, this.f).catch(() => null);
    const values = {
      provider: id,
      accountLabel: account,
      scopes: t.scope ? t.scope.split(/[ ,]+/).filter(Boolean) : OAUTH_PROVIDERS[id].scopes,
      accessTokenEnc: this.enc(t.access_token!),
      refreshTokenEnc: t.refresh_token ? this.enc(t.refresh_token) : null,
      accessTokenExpiresAt: new Date(this.now().getTime() + (t.expires_in ?? 3600) * 1000),
      status: "connected",
      lastError: null,
      connectedBy: row.userId,
    };
    await this.o.db.insert(schema.integrationConnections).values(values).onConflictDoUpdate({ target: schema.integrationConnections.provider, set: { ...values, updatedAt: this.now() } });
    return id;
  }

  /** A valid access token, refreshed when needed. */
  async accessToken(id: OAuthProviderId): Promise<string> {
    const c = await this.connection(id);
    const label = OAUTH_PROVIDERS[id].label;
    if (!c || c.status === "revoked") throw new IntegrationError("NOT_CONNECTED", `${label} isn't connected. The owner can connect it on the Integrations page.`);
    if (c.status === "error") throw new IntegrationError("NOT_CONNECTED", `${label} needs to be reconnected (${c.lastError ?? "access was revoked"}).`);
    if (c.accessTokenEnc && c.accessTokenExpiresAt && c.accessTokenExpiresAt.getTime() - this.now().getTime() > 60_000) return this.dec(c.accessTokenEnc);
    if (!c.refreshTokenEnc) throw new IntegrationError("NOT_CONNECTED", `${label} access expired and can't be refreshed. Reconnect it.`);
    try {
      const t = await this.tokenRequest(id, { grant_type: "refresh_token", refresh_token: this.dec(c.refreshTokenEnc) });
      await this.o.db
        .update(schema.integrationConnections)
        .set({
          accessTokenEnc: this.enc(t.access_token!),
          accessTokenExpiresAt: new Date(this.now().getTime() + (t.expires_in ?? 3600) * 1000),
          // Canva rotates refresh tokens; Google keeps the old one.
          ...(t.refresh_token ? { refreshTokenEnc: this.enc(t.refresh_token) } : {}),
        })
        .where(eq(schema.integrationConnections.id, c.id));
      return t.access_token!;
    } catch (e) {
      if ((e as { oauthError?: string }).oauthError === "invalid_grant") {
        await this.o.db.update(schema.integrationConnections).set({ status: "error", lastError: "Access was revoked or expired" }).where(eq(schema.integrationConnections.id, c.id));
        throw new IntegrationError("NOT_CONNECTED", `${label} access was revoked or expired. Reconnect it.`);
      }
      throw e;
    }
  }

  /** Live check used by the Integrations page: refreshes if needed and reads the account name. */
  async test(id: OAuthProviderId): Promise<{ ok: boolean; message: string }> {
    try {
      const account = await OAUTH_PROVIDERS[id].account(await this.accessToken(id), this.f);
      return account ? { ok: true, message: `Connected as ${account}` } : { ok: false, message: "The token works but the account couldn't be read" };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /** Revokes at the provider (best effort) and forgets the tokens. */
  async disconnect(id: OAuthProviderId) {
    const c = await this.connection(id);
    if (!c) return false;
    const p = OAUTH_PROVIDERS[id];
    const token = c.refreshTokenEnc ? this.dec(c.refreshTokenEnc) : c.accessTokenEnc ? this.dec(c.accessTokenEnc) : null;
    if (token && p.revokeUrl && this.missingEnv(id).length === 0) {
      const { clientId, clientSecret } = this.creds(id);
      await this.f(p.revokeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...(p.basicAuth ? { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` } : {}),
        },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    }
    await this.o.db.delete(schema.integrationConnections).where(eq(schema.integrationConnections.id, c.id));
    return true;
  }

  /** Authenticated JSON request to the provider's API. */
  async request<T>(id: OAuthProviderId, url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken(id);
    const res = await this.f(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string>) },
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } | string; message?: string };
    if (!res.ok) {
      const msg = typeof data.error === "string" ? data.error : (data.error?.message ?? data.message ?? `HTTP ${res.status}`);
      throw Object.assign(new IntegrationError("PROVIDER_ERROR", `${OAUTH_PROVIDERS[id].label}: ${msg}`), { httpStatus: res.status });
    }
    return data;
  }
}
