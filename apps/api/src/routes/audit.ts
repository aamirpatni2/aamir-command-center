import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, lt, schema, type Database } from "@acc/database";
import { parse } from "../lib/errors.js";
import { requireAuth } from "../plugins/auth.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(50).optional(),
});

export async function auditRoutes(app: FastifyInstance, opts: { db: Database }) {
  app.get("/api/audit-logs", { preHandler: requireAuth("audit:read") }, async (req) => {
    const q = parse(querySchema, req.query);
    const filters = [
      q.before ? lt(schema.auditLogs.createdAt, q.before) : undefined,
      q.action ? eq(schema.auditLogs.action, q.action) : undefined,
      q.entityType ? eq(schema.auditLogs.entityType, q.entityType) : undefined,
    ].filter((f) => f !== undefined);
    const rows = await opts.db
      .select()
      .from(schema.auditLogs)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(q.limit);
    return { auditLogs: rows, nextBefore: rows.length === q.limit ? rows.at(-1)!.createdAt : null };
  });
}
