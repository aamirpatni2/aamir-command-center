import type { FastifyInstance } from "fastify";
import { and, burnPasswordCheck, eq, isNull, schema, verifyPassword, writeAudit, type Database } from "@acc/database";
import { loginRequestSchema, permissionsFor, type Role, type SessionResponse } from "@acc/shared";
import { HttpError, parse, unauthorized } from "../lib/errors.js";
import { requireAuth } from "../plugins/auth.js";
import { auditMeta } from "../lib/audit.js";

export interface AuthRouteOptions {
  db: Database;
  loginRateLimit: { max: number; timeWindow: string };
}

export async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions) {
  const { db } = opts;

  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: {
          ...opts.loginRateLimit,
          // Key on IP + email so one attacker can't lock everyone out, and one account can't be brute-forced.
          keyGenerator: (req) => {
            const email = (req.body as { email?: unknown } | undefined)?.email;
            return `login:${req.ip}:${typeof email === "string" ? email.toLowerCase().slice(0, 254) : ""}`;
          },
        },
      },
    },
    async (req, reply) => {
      const body = parse(loginRequestSchema, req.body);
      const [user] = await db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.email, body.email), isNull(schema.users.deletedAt)))
        .limit(1);

      const ok = user ? await verifyPassword(user.passwordHash, body.password) : (await burnPasswordCheck(body.password), false);
      if (!user || !ok || !user.isActive) {
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
