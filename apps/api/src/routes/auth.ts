import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, burnPasswordCheck, eq, hashPassword, isNull, schema, verifyPassword, writeAudit, type Database } from "@acc/database";
import { loginRequestSchema, newPasswordSchema, permissionsFor, weakPasswordReason, type Role, type SessionResponse } from "@acc/shared";
import { HttpError, parse, unauthorized } from "../lib/errors.js";
import { requireAuth } from "../plugins/auth.js";
import { auditMeta } from "../lib/audit.js";
import { LoginThrottle } from "../lib/login-throttle.js";
import type { WindowStore } from "../lib/window-store.js";

export interface AuthRouteOptions {
  db: Database;
  /** Failed attempts allowed per IP + email inside the window. */
  loginFailures: { max: number; windowMs: number };
  /** Coarse cap on all login requests per IP (stops spraying many emails). */
  loginIpRateLimit: { max: number; timeWindow: string };
  limits: WindowStore;
}

export async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions) {
  const { db } = opts;
  const throttle = new LoginThrottle(opts.limits, opts.loginFailures.max, opts.loginFailures.windowMs);

  app.post(
    "/api/auth/login",
    {
      config: { rateLimit: { ...opts.loginIpRateLimit, keyGenerator: (req) => `login-ip:${req.ip}` } },
    },
    async (req, reply) => {
      const body = parse(loginRequestSchema, req.body);
      const wait = await throttle.retryAfter(req.ip, body.email);
      if (wait > 0) {
        reply.header("retry-after", String(wait));
        throw new HttpError(429, "RATE_LIMITED", "Too many failed attempts. Try again later.");
      }
      const [user] = await db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.email, body.email), isNull(schema.users.deletedAt)))
        .limit(1);

      const ok = user ? await verifyPassword(user.passwordHash, body.password) : (await burnPasswordCheck(body.password), false);
      if (!user || !ok || !user.isActive) {
        await throttle.recordFailure(req.ip, body.email);
        await writeAudit(db, {
          ...auditMeta(req),
          actorType: "system",
          action: "auth.login_failed",
          entityType: "user",
          entityId: user?.id ?? null,
          metadata: { reason: !user ? "unknown_email" : !ok ? "bad_password" : "inactive" },
        });
        throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password");
      }

      await throttle.reset(req.ip, body.email);
      const session = await app.sessions.create(user.id, { ip: req.ip, userAgent: req.headers["user-agent"] });
      await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
      await writeAudit(db, {
        ...auditMeta(req),
        actorType: "user",
        actorId: user.id,
        action: "auth.login",
        entityType: "session",
        entityId: session.sessionId,
      });
      app.sessions.setCookie(reply, session.token, session.expiresAt);
      const role = user.role as Role;
      const res: SessionResponse = {
        user: { id: user.id, email: user.email, name: user.name, role },
        csrfToken: session.csrfToken,
        permissions: permissionsFor(role),
      };
      return res;
    },
  );

  /** Change your own password: needs the current one; every other session is signed out. */
  app.post(
    "/api/auth/password",
    { preHandler: requireAuth(), config: { rateLimit: { max: 10, timeWindow: "15 minutes", keyGenerator: (req) => `pw:${req.auth?.user.id ?? req.ip}` } } },
    async (req) => {
      const body = parse(z.object({ currentPassword: z.string().min(1).max(256), newPassword: newPasswordSchema }), req.body);
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, req.auth!.user.id));
      if (!user || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
        await writeAudit(db, { ...auditMeta(req), action: "auth.password_change_failed", entityType: "user", entityId: req.auth!.user.id });
        throw new HttpError(400, "INVALID_CREDENTIALS", "The current password is incorrect");
      }
      const problem = weakPasswordReason(body.newPassword, user.email, body.currentPassword);
      if (problem) throw new HttpError(400, "WEAK_PASSWORD", problem, [{ path: "newPassword", message: problem }]);
      await db.update(schema.users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(schema.users.id, user.id));
      const revoked = await app.sessions.revokeOthers(user.id, req.auth!.sessionId);
      await writeAudit(db, { ...auditMeta(req), action: "auth.password_changed", entityType: "user", entityId: user.id, metadata: { otherSessionsRevoked: revoked } });
      return { ok: true, otherSessionsRevoked: revoked };
    },
  );

  app.get("/api/auth/me", async (req) => {
    if (!req.auth) throw unauthorized();
    const res: SessionResponse = {
      user: req.auth.user,
      csrfToken: req.auth.csrfToken,
      permissions: permissionsFor(req.auth.user.role),
    };
    return res;
  });

  app.post("/api/auth/logout", { preHandler: requireAuth() }, async (req, reply) => {
    const auth = req.auth!;
    await app.sessions.revoke(auth.sessionId);
    await writeAudit(db, { ...auditMeta(req), action: "auth.logout", entityType: "session", entityId: auth.sessionId });
    app.sessions.clearCookie(reply);
    return reply.code(204).send();
  });

  app.post("/api/auth/logout-all", { preHandler: requireAuth() }, async (req, reply) => {
    const auth = req.auth!;
    await app.sessions.revokeAllForUser(auth.user.id);
    await writeAudit(db, { ...auditMeta(req), action: "auth.logout_all", entityType: "user", entityId: auth.user.id });
    app.sessions.clearCookie(reply);
    return reply.code(204).send();
  });
}
