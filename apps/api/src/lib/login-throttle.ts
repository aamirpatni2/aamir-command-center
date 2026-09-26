import type { WindowStore } from "./window-store.js";

/**
 * Counts FAILED logins per (ip, email) in a sliding window. Successful logins don't consume
 * the budget and clear it. Stored in Redis in production, so restarts don't reset it.
 */
export class LoginThrottle {
  constructor(
    private readonly store: WindowStore,
    private readonly maxFailures: number,
    private readonly windowMs: number,
  ) {}

  private key(ip: string, email: string) {
    return `login:${ip}|${email.toLowerCase()}`;
  }

  /** Seconds until another attempt is allowed, or 0 if allowed now. */
  async retryAfter(ip: string, email: string, now = Date.now()): Promise<number> {
    const { count, retryAfter } = await this.store.peek(this.key(ip, email), this.windowMs, now);
    return count < this.maxFailures ? 0 : retryAfter;
  }

  async recordFailure(ip: string, email: string, now = Date.now()) {
    await this.store.add(this.key(ip, email), this.windowMs, now);
  }

  async reset(ip: string, email: string) {
    await this.store.clear(this.key(ip, email));
  }
}
