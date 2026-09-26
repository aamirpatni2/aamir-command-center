import type { FastifyBaseLogger } from "fastify";
import type { AutomationQueue } from "@acc/agents";
import type { AutomationEvent } from "@acc/shared";

/** Emits an automation event without ever failing the caller's request (Redis down → logged, not thrown). */
export async function emitEvent(queue: AutomationQueue, log: FastifyBaseLogger, event: AutomationEvent, ref: Record<string, unknown>, refId: string) {
  try {
    await queue.emit(event, ref, refId);
  } catch (err) {
    log.warn({ err, event, refId }, "automation event not queued");
  }
}
