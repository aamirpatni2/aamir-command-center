import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "./errors.js";
import type { WindowStore } from "./window-store.js";

/**
 * One budget per signed-in user for everything that starts an AI agent run (tasks, WhatsApp
 * triage, written reports): each run can cost API credits. A sliding window shared across those
 * endpoints (a per-route limiter would give each endpoint its own budget), kept in Redis so it
 * survives restarts and holds across API instances.
 */
export class AgentRunLimiter {
  constructor(
    private readonly store: WindowStore,
    readonly max: number,
    readonly windowMs: number,
  ) {}

  /** Records a run if allowed; otherwise returns the seconds to wait. */
  async take(key: string, now = Date.now()): Promise<number> {
    const r = await this.store.take(`agent-runs:${key}`, this.max, this.windowMs, now);
    return r.allowed ? 0 : r.retryAfter;
  }

  /** preHandler: use after requireAuth. */
  guard = async (req: FastifyRequest, reply: FastifyReply) => {
    const wait = await this.take(req.auth?.user.id ?? `ip:${req.ip}`);
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
