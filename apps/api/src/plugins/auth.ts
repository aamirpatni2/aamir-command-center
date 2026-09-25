import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, isNull, schema, type Database } from "@acc/database";
import { hasPermission, type Permission, type PublicUser, type Role } from "@acc/shared";
import { forbidden, HttpError, unauthorized } from "../lib/errors.js";
import { hashToken, randomToken, safeEqual } from "../lib/tokens.js";

export const SESSION_COOKIE = "acc_session";
export const CSRF_HEADER = "x-csrf-token";
const SLIDE_INTERVAL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AuthContext {
  user: PublicUser;
  sessionId: string;
  csrfToken: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    sessions: SessionService;
  }
}

export interface AuthPluginOptions {
  db: Database;
  secret: string;
  ttlDays: number;
  absoluteTtlDays: number;
  secureCookies: boolean;
}

export class SessionService {
  constructor(private readonly opts: AuthPluginOptions) {}

  async create(userId: string, meta: { ip?: string; userAgent?: string }) {
    const token = randomToken();
    const csrfToken = randomToken();
    const now = Date.now();
    const absoluteExpiresAt = new Date(now + this.opts.absoluteTtlDays * DAY_MS);
    const expiresAt = new Date(Math.min(now + this.opts.ttlDays * DAY_MS, absoluteExpiresAt.getTime()));
    const [row] = await this.opts.db
      .insert(schema.sessions)
      .values({
        userId,
        tokenHash: hashToken(token, this.opts.secret),
        csrfToken,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
        expiresAt,
        absoluteExpiresAt,
      })
      .returning({ id: schema.sessions.id });
    return { token, csrfToken, sessionId: row!.id, expiresAt };
  }

  async resolve(token: string): Promise<AuthContext | null> {
    const { db, secret, ttlDays } = this.opts;
    const now = new Date();
    const rows = await db
      .select({ session: schema.sessions, user: schema.users })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(
        and(
          eq(schema.sessions.tokenHash, hashToken(token, secret)),
          isNull(schema.sessions.revokedAt),
          gt(schema.sessions.expiresAt, now),
          gt(schema.sessions.absoluteExpiresAt, now),
          eq(schema.users.isActive, true),
          isNull(schema.users.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    // Sliding idle expiry, written at most every few minutes.
    if (now.getTime() - row.session.lastSeenAt.getTime() > SLIDE_INTERVAL_MS) {
      const expiresAt = new Date(Math.min(now.getTime() + ttlDays * DAY_MS, row.session.absoluteExpiresAt.getTime()));
      await db
        .update(schema.sessions)
        .set({ lastSeenAt: now, expiresAt })
        .where(eq(schema.sessions.id, row.session.id));
    }
    return {
      sessionId: row.session.id,
      csrfToken: row.session.csrfToken,
      user: { id: row.user.id, email: row.user.email, name: row.user.name, role: row.user.role as Role },
    };
  }

  async revoke(sessionId: string) {
    await this.opts.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)));
  }

  async revokeAllForUser(userId: string) {
    await this.opts.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
  }

  setCookie(reply: FastifyReply, token: string, expiresAt: Date) {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.opts.secureCookies,
      sameSite: "strict",
      path: "/",
      expires: expiresAt,
    });
  }

  clearCookie(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
  }
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const authPlugin = fp<AuthPluginOptions>(async (app, opts) => {
  const sessions = new SessionService(opts);
  app.decorate("sessions", sessions);
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.auth = await sessions.resolve(token);
  });
});

/** Route guard: requires a valid session and, for state-changing requests, a matching CSRF token. */
export function requireAuth(permission?: Permission) {
  return async (req: FastifyRequest) => {
    if (!req.auth) throw unauthorized();
    if (MUTATING.has(req.method)) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== "string" || !safeEqual(header, req.auth.csrfToken)) {
        throw new HttpError(403, "CSRF_INVALID", "Missing or invalid CSRF token");
      }
    }
    if (permission && !hasPermission(req.auth.user.role, permission)) throw forbidden();
  };
}
