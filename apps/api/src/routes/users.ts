import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, count, eq, hashPassword, isNull, schema, writeAudit, type Database } from "@acc/database";
import { addMemberRequestSchema, newPasswordSchema, ROLES, weakPasswordReason, type LinkPurpose } from "@acc/shared";
import { conflict, forbidden, HttpError, notFound, parse } from "../lib/errors.js";
import { requireAuth } from "../plugins/auth.js";
import { auditMeta } from "../lib/audit.js";
import { inviteEmail, resetEmail } from "../lib/emails.js";
import type { Mailer } from "../lib/mailer.js";
import { randomToken } from "../lib/tokens.js";
import { issueLink, linkUrl, pendingInvites, revokeOpenLinks } from "../lib/user-links.js";

const publicColumns = {
  id: schema.users.id,
  email: schema.users.email,
  name: schema.users.name,
  role: schema.users.role,
  isActive: schema.users.isActive,
  lastLoginAt: schema.users.lastLoginAt,
  createdAt: schema.users.createdAt,
};

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

const idParam = z.object({ id: z.string().uuid() });
const resetPasswordSchema = z.object({ password: newPasswordSchema });

export interface UserRouteOptions {
  db: Database;
  mailer: Mailer;
  /** HMAC key for emailed link tokens (the session secret). */
  secret: string;
  publicUrl: string;
}

export async function userRoutes(app: FastifyInstance, opts: UserRouteOptions) {
  const { db, mailer } = opts;
  const activeUser = isNull(schema.users.deletedAt);

  /** Emails an invite or reset link. A link that couldn't be delivered is revoked again. */
  async function sendLink(purpose: LinkPurpose, target: { id: string; email: string; name: string; role: string }, inviter: { id: string; name: string }) {
    const { token, expiresAt } = await issueLink(db, opts.secret, { userId: target.id, purpose, sentTo: target.email, createdBy: inviter.id });
    const link = linkUrl(opts.publicUrl, token);
    const mail =
      purpose === "invite"
        ? inviteEmail({ to: target.email, name: target.name, inviter: inviter.name, role: target.role, link, expiresAt })
        : resetEmail({ to: target.email, name: target.name, inviter: inviter.name, link, expiresAt });
    const result = await mailer.send(mail);
    if (result.status === "failed" || result.status === "not_configured") await revokeOpenLinks(db, target.id, purpose);
    return { status: result.status, expiresAt: expiresAt.toISOString(), ...(result.status === "failed" ? { error: result.error } : {}) };
  }

  const requireEmail = () => {
    if (mailer.mode === "off") throw new HttpError(400, "EMAIL_NOT_CONFIGURED", "Email isn't set up (SMTP_URL and EMAIL_FROM). Use a temporary password instead.");
  };

  app.get("/api/users", { preHandler: requireAuth("users:read") }, async () => {
    const users = await db.select(publicColumns).from(schema.users).where(activeUser).orderBy(asc(schema.users.createdAt));
    const invites = await pendingInvites(db);
    const now = Date.now();
    return {
      emailMode: mailer.mode,
      users: users.map((u) => {
        const expiresAt = invites.get(u.id);
        return { ...u, invite: expiresAt ? { expiresAt: expiresAt.toISOString(), expired: expiresAt.getTime() <= now } : null };
      }),
    };
  });

  app.post("/api/users", { preHandler: requireAuth("users:manage") }, async (req, reply) => {
    const body = parse(addMemberRequestSchema, req.body);
    if (body.sendInvite) requireEmail();
    const existing = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.email, body.email), activeUser));
    if (existing.length) throw conflict("A user with this email already exists");
    if (body.password) {
      const weak = weakPasswordReason(body.password, body.email);
      if (weak) throw new HttpError(400, "WEAK_PASSWORD", weak, [{ path: "password", message: weak }]);
    }
    // Invited people get an unguessable password nobody knows until they choose their own.
    const [user] = await db
      .insert(schema.users)
      .values({ email: body.email, name: body.name, role: body.role, passwordHash: await hashPassword(body.password ?? randomToken(32)) })
      .returning(publicColumns);
    await writeAudit(db, { ...auditMeta(req), action: "user.create", entityType: "user", entityId: user!.id, metadata: { role: body.role, via: body.sendInvite ? "invite" : "temporary_password" } });
    if (!body.sendInvite) return reply.code(201).send({ user });
    const invite = await sendLink("invite", user!, req.auth!.user);
    await writeAudit(db, { ...auditMeta(req), action: "user.invite_sent", entityType: "user", entityId: user!.id, metadata: { status: invite.status } });
    return reply.code(201).send({ user, invite });
  });

  /** Sends a new invite (the old link stops working). Only for people who haven't signed in yet. */
  app.post("/api/users/:id/invite", { preHandler: requireAuth("users:manage") }, async (req) => {
    const { id } = parse(idParam, req.params);
    requireEmail();
    const [target] = await db.select().from(schema.users).where(and(eq(schema.users.id, id), activeUser));
    if (!target) throw notFound("User");
    if (!target.isActive) throw new HttpError(409, "INACTIVE", "Reactivate this person before inviting them");
    if (target.lastLoginAt) throw new HttpError(409, "ALREADY_JOINED", "They have already signed in; send a reset link instead");
    const invite = await sendLink("invite", target, req.auth!.user);
    await writeAudit(db, { ...auditMeta(req), action: "user.invite_sent", entityType: "user", entityId: id, metadata: { status: invite.status, resend: true } });
    return { invite };
  });

  /** Emails a one-hour link to choose a new password. Never for yourself (use Settings). */
  app.post("/api/users/:id/reset-link", { preHandler: requireAuth("users:manage") }, async (req) => {
    const { id } = parse(idParam, req.params);
    requireEmail();
    if (id === req.auth!.user.id) throw forbidden("Change your own password in Settings");
    const [target] = await db.select().from(schema.users).where(and(eq(schema.users.id, id), activeUser));
    if (!target) throw notFound("User");
    if (!target.isActive) throw new HttpError(409, "INACTIVE", "Reactivate this person first");
    const link = await sendLink("reset", target, req.auth!.user);
    await writeAudit(db, { ...auditMeta(req), action: "user.reset_link_sent", entityType: "user", entityId: id, metadata: { status: link.status } });
    return { link };
  });

  app.patch("/api/users/:id", { preHandler: requireAuth("users:manage") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(updateUserSchema, req.body);
    const [target] = await db.select().from(schema.users).where(and(eq(schema.users.id, id), activeUser));
    if (!target) throw notFound("User");

    const losingOwner = target.role === "owner" && ((body.role && body.role !== "owner") || body.isActive === false);
    if (losingOwner) {
      if (target.id === req.auth!.user.id) throw forbidden("You cannot demote or deactivate your own owner account");
      const [owners] = await db
        .select({ n: count() })
        .from(schema.users)
        .where(and(eq(schema.users.role, "owner"), eq(schema.users.isActive, true), activeUser));
      if ((owners?.n ?? 0) <= 1) throw forbidden("The last active owner cannot be demoted or deactivated");
    }

    if (body.email && body.email !== target.email) {
      // Deactivated accounts keep their email (their history stays attached), so they count too.
      const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.email, body.email), activeUser));
      if (taken && taken.id !== id) throw conflict("Another account already uses this email");
    }

    const [user] = await db
      .update(schema.users)
      .set(body)
      .where(eq(schema.users.id, id))
      .returning(publicColumns)
      .catch((err: unknown) => {
        // Two edits racing for the same address: the unique index decides.
        if (String((err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code) === "23505") throw conflict("Another account already uses this email");
        throw err;
      });
    // Links already emailed to the old address, or to someone now deactivated, stop working.
    if ((body.email && body.email !== target.email) || body.isActive === false) await revokeOpenLinks(db, id);
    if (body.isActive === false || (body.role && body.role !== target.role)) {
      await app.sessions.revokeAllForUser(id); // permissions changed → force re-login
    }
    await writeAudit(db, {
      ...auditMeta(req),
      action: "user.update",
      entityType: "user",
      entityId: id,
      metadata: { before: { name: target.name, email: target.email, role: target.role, isActive: target.isActive }, after: body },
    });
    return { user };
  });

  /**
   * The owner sets a temporary password for a team member who forgot theirs. Signs them out
   * everywhere; they should change it in Settings. Your own password is changed in Settings
   * (which asks for the current one), never here.
   */
  app.post("/api/users/:id/password", { preHandler: requireAuth("users:manage") }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { password } = parse(resetPasswordSchema, req.body);
    if (id === req.auth!.user.id) throw forbidden("Change your own password in Settings");
    const [target] = await db.select().from(schema.users).where(and(eq(schema.users.id, id), activeUser));
    if (!target) throw notFound("User");
    const weak = weakPasswordReason(password, target.email);
    if (weak) throw new HttpError(400, "WEAK_PASSWORD", weak, [{ path: "password", message: weak }]);
    await db.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, id));
    await revokeOpenLinks(db, id);
    await app.sessions.revokeAllForUser(id);
    await writeAudit(db, { ...auditMeta(req), action: "user.password_reset", entityType: "user", entityId: id });
    return { ok: true };
  });
}
