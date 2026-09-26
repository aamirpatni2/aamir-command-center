import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, count, eq, hashPassword, isNull, schema, writeAudit, type Database } from "@acc/database";
import { createUserRequestSchema, ROLES, weakPasswordReason } from "@acc/shared";
import { conflict, forbidden, HttpError, notFound, parse } from "../lib/errors.js";
import { requireAuth } from "../plugins/auth.js";
import { auditMeta } from "../lib/audit.js";

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
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

const idParam = z.object({ id: z.string().uuid() });

export async function userRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const activeUser = isNull(schema.users.deletedAt);

  app.get("/api/users", { preHandler: requireAuth("users:read") }, async () => ({
    users: await db.select(publicColumns).from(schema.users).where(activeUser).orderBy(asc(schema.users.createdAt)),
  }));

  app.post("/api/users", { preHandler: requireAuth("users:manage") }, async (req, reply) => {
    const body = parse(createUserRequestSchema, req.body);
    const existing = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.email, body.email), activeUser));
    if (existing.length) throw conflict("A user with this email already exists");
    const weak = weakPasswordReason(body.password, body.email);
    if (weak) throw new HttpError(400, "WEAK_PASSWORD", weak, [{ path: "password", message: weak }]);
    const [user] = await db
      .insert(schema.users)
      .values({ email: body.email, name: body.name, role: body.role, passwordHash: await hashPassword(body.password) })
      .returning(publicColumns);
    await writeAudit(db, { ...auditMeta(req), action: "user.create", entityType: "user", entityId: user!.id, metadata: { role: body.role } });
    return reply.code(201).send({ user });
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

    const [user] = await db.update(schema.users).set(body).where(eq(schema.users.id, id)).returning(publicColumns);
    if (body.isActive === false || (body.role && body.role !== target.role)) {
      await app.sessions.revokeAllForUser(id); // permissions changed → force re-login
    }
    await writeAudit(db, {
      ...auditMeta(req),
      action: "user.update",
      entityType: "user",
      entityId: id,
      metadata: { before: { role: target.role, isActive: target.isActive }, after: body },
    });
    return { user };
  });
}
