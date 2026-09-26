import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { parseWhatsappWebhook, verifyWhatsappSignature, type TaskQueue, type AutomationQueue } from "@acc/agents";
import type { Env } from "@acc/config";
import { and, applyOutboundStatus, eq, ingestInboundMessage, schema, type Database } from "@acc/database";
import { safeEqual } from "../lib/tokens.js";
import { emitEvent } from "../lib/automation-events.js";

export interface WebhookRouteOptions {
  db: Database;
  env: Env;
  queue: TaskQueue;
  automations: AutomationQueue;
}

/**
 * WhatsApp Cloud API webhook. Registered in its own encapsulated context so the raw body is
 * available for signature verification (HMAC over the exact bytes Meta sent).
 */
export async function whatsappWebhookRoutes(app: FastifyInstance, opts: WebhookRouteOptions) {
  const { db, env, queue, automations } = opts;

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));

  // Subscription handshake: Meta calls this once when the webhook URL is configured.
  app.get("/api/webhooks/whatsapp", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (!env.WHATSAPP_VERIFY_TOKEN) return reply.code(503).send({ error: { code: "NOT_CONFIGURED", message: "WHATSAPP_VERIFY_TOKEN is not set" } });
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] && safeEqual(q["hub.verify_token"], env.WHATSAPP_VERIFY_TOKEN)) {
      return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    }
    return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Verification failed" } });
  });

  app.post("/api/webhooks/whatsapp", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!env.WHATSAPP_APP_SECRET) {
      return reply.code(503).send({ error: { code: "NOT_CONFIGURED", message: "WHATSAPP_APP_SECRET is not set" } });
    }
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw) || !verifyWhatsappSignature(raw, req.headers["x-hub-signature-256"] as string | undefined, env.WHATSAPP_APP_SECRET)) {
      req.log.warn("whatsapp webhook: invalid signature");
      return reply.code(401).send({ error: { code: "INVALID_SIGNATURE", message: "Invalid signature" } });
    }

    // Replay protection: an identical signed body is processed once. A delivery that failed
    // earlier is allowed through again so Meta's retry can succeed.
    const bodyHash = createHash("sha256").update(raw).digest("hex");
    const [inserted] = await db
      .insert(schema.webhookEvents)
      .values({ provider: "whatsapp", bodyHash })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvents.id });
    let eventId = inserted?.id;
    if (!eventId) {
      const [existing] = await db
        .select({ id: schema.webhookEvents.id, status: schema.webhookEvents.status })
        .from(schema.webhookEvents)
        .where(and(eq(schema.webhookEvents.provider, "whatsapp"), eq(schema.webhookEvents.bodyHash, bodyHash)));
      if (existing?.status !== "failed") return { status: "duplicate" };
      eventId = existing.id;
      await db.update(schema.webhookEvents).set({ status: "received", error: null }).where(eq(schema.webhookEvents.id, eventId));
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      await db.update(schema.webhookEvents).set({ status: "ignored", error: "invalid JSON", processedAt: new Date() }).where(eq(schema.webhookEvents.id, eventId));
      return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "Invalid JSON" } });
    }
    const parsed = parseWhatsappWebhook(payload);
    if (!parsed) {
      // Unknown or unsupported event shape: acknowledge so Meta doesn't retry forever.
      await db.update(schema.webhookEvents).set({ status: "ignored", processedAt: new Date() }).where(eq(schema.webhookEvents.id, eventId));
      return { status: "ignored" };
    }

    try {
      const summary = { messages: 0, duplicates: 0, newLeads: 0, statuses: 0, triaged: 0 };
      for (const m of parsed.messages) {
        const r = await ingestInboundMessage(db, { channel: "whatsapp", ...m });
        if (r.duplicate) {
          summary.duplicates++;
          continue;
        }
        summary.messages++;
        if (r.leadCreated) summary.newLeads++;
        await emitEvent(automations, req.log, "whatsapp.message_received", { messageId: r.message.id, leadNew: r.leadCreated }, r.message.id);
        if (r.leadCreated && r.lead) await emitEvent(automations, req.log, "lead.created", { leadId: r.lead.id }, r.lead.id);
        if (env.WHATSAPP_AUTO_TRIAGE && (m.text || m.media)) {
          await queue.enqueueTriage(r.conversation.id, env.WHATSAPP_TRIAGE_DELAY_SECONDS * 1000);
          summary.triaged++;
        }
      }
      for (const s of parsed.statuses) if (await applyOutboundStatus(db, s.providerMessageId, s.status)) summary.statuses++;
      await db.update(schema.webhookEvents).set({ status: "processed", summary, processedAt: new Date() }).where(eq(schema.webhookEvents.id, eventId));
      return { status: "ok", ...summary };
    } catch (err) {
      req.log.error({ err }, "whatsapp webhook processing failed");
      await db.update(schema.webhookEvents).set({ status: "failed", error: (err as Error).message.slice(0, 500) }).where(eq(schema.webhookEvents.id, eventId));
      return reply.code(500).send({ error: { code: "INTERNAL", message: "Processing failed; will accept a retry" } });
    }
  });
}
