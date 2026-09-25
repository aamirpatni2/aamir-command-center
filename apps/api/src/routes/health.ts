import type { FastifyInstance } from "fastify";
import { integrationStatus } from "@acc/config";
import { sql, type Database } from "@acc/database";
import { requireAuth } from "../plugins/auth.js";

export async function healthRoutes(app: FastifyInstance, opts: { db: Database }) {
  app.get("/api/health", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await opts.db.execute(sql`select 1`);
      return { status: "ok", db: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded", db: "unreachable" });
    }
  });

  // Booleans only: which integrations have credentials. Values are never returned.
  app.get("/api/health/integrations", { preHandler: requireAuth("mcp:read") }, async () => ({
    integrations: integrationStatus(),
  }));
}
