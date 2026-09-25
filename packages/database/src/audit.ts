import type { Database } from "./client.js";
import { auditLogs } from "./schema/index.js";

export interface AuditEntry {
  actorType: "user" | "agent" | "system";
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** Append-only audit writer. Never log secrets or full message bodies in metadata. */
export async function writeAudit(db: Database, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
    userAgent: entry.userAgent?.slice(0, 512) ?? null,
    requestId: entry.requestId ?? null,
  });
}
