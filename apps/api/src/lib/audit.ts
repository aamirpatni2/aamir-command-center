import type { FastifyRequest } from "fastify";
import type { AuditEntry } from "@acc/database";

/** Common audit fields taken from the request. Callers add action/entity. */
export function auditMeta(req: FastifyRequest): Pick<AuditEntry, "actorType" | "actorId" | "ip" | "userAgent" | "requestId"> {
  return {
    actorType: req.auth ? "user" : "system",
    actorId: req.auth?.user.id ?? null,
    ip: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
    requestId: req.id,
  };
}
