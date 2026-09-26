import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "./errors.js";

/**
 * One budget per signed-in user for everything that starts an AI agent run (tasks, WhatsApp
 * triage, written reports): each run can cost API credits. A sliding window shared across those
 * endpoints (a per-route limiter would give each endpoint its own budget). In-memory: fine for a
 * single API instance; move to Redis when running several.
 */
export class AgentRunLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}

  /** Records a run if allowed; otherwise returns the seconds to wait. */
  take(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    return 0;
  }

  /** preHandler: use after requireAuth. */
  guard = async (req: FastifyRequest, reply: FastifyReply) => {
    const wait = this.take(req.auth?.user.id ?? `ip:${req.ip}`);
    if (wait > 0) {
      reply.header("retry-after", String(wait));
      throw new HttpError(429, "RATE_LIMITED", `You've started ${this.max} agent runs in the last ${Math.round(this.windowMs / 60_000)} minutes. Try again in ${Math.ceil(wait / 60)} minute(s).`);
    }
  };
}

declare module "fastify" {
  interface FastifyInstance {
    agentRuns: AgentRunLimiter;
    routeTable: { method: string; url: string }[];
  }
}
