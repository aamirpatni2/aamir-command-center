/**
 * Public endpoints behind the emailed links (/invite#<token>): look up a link and set a password.
 * No session needed: the 256-bit single-use token is the credential. Rate-limited per IP.
 */
import type { FastifyInstance } from "fastify";
import { eq, hashPassword, schema, writeAudit, type Database } from "@acc/database";
import { acceptLinkSchema, linkTokenSchema, weakPasswordReason, type LinkInfo } from "@acc/shared";
import { z } from "zod";
import { HttpError, parse } from "../lib/errors.js";
import { auditMeta } from "../lib/audit.js";
import { consumeLink, findUsableLink, revokeOpenLinks } from "../lib/user-links.js";

const invalid = () => new HttpError(400, "INVALID_LINK", "This link has expired or was already used. Ask the owner to send a new one.");

export async function inviteRoutes(app: FastifyInstance, opts: { db: Database; secret: string }) {
  const { db } = opts;
  const rateLimit = { max: 20, timeWindow: "15 minutes", keyGenerator: (req: { ip?: string }) => `links:${req.ip ?? "disconnected"}` };

  app.post("/api/invites/lookup", { config: { rateLimit } }, async (req): Promise<LinkInfo> => {
    const { token } = parse(z.object({ token: linkTokenSchema }), req.body);
    const found = await findUsableLink(db, opts.secret, token);
    if (!found) throw invalid();
    return { purpose: found.link.purpose, name: found.user.name, email: found.user.email, expiresAt: found.link.expiresAt.toISOString() };
  });

  app.post("/api/invites/accept", { config: { rateLimit } }, async (req) => {
    const { token, password } = parse(acceptLinkSchema, req.body);
    const found = await findUsableLink(db, opts.secret, token);
    if (!found) throw invalid();
    // Check the password before using up the link, so a weak choice doesn't burn it.
    const weak = weakPasswordReason(password, found.user.email);
    if (weak) throw new HttpError(400, "WEAK_PASSWORD", weak, [{ path: "password", message: weak }]);
    if (!(await consumeLink(db, found.link.id))) throw invalid();

    await db.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, found.user.id));
    await revokeOpenLinks(db, found.user.id); // any other open invite/reset link
    await app.sessions.revokeAllForUser(found.user.id); // a reset signs out everywhere
    await writeAudit(db, {
      ...auditMeta(req),
      actorType: "user",
      actorId: found.user.id,
      action: found.link.purpose === "invite" ? "user.invite_accepted" : "user.password_reset_by_link",
      entityType: "user",
      entityId: found.user.id,
    });
    return { ok: true, email: found.user.email, purpose: found.link.purpose };
  });
}
