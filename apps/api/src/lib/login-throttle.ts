/**
 * Counts FAILED logins per (ip, email) in a sliding window. Successful logins don't consume
 * the budget and clear it. In-memory: fine for one API instance; move to Redis when scaling out.
 */
export class LoginThrottle {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
  ) {}

  private key(ip: string, email: string) {
    return `${ip}|${email.toLowerCase()}`;
  }

  private recent(key: string, now: number) {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Seconds until another attempt is allowed, or 0 if allowed now. */
  retryAfter(ip: string, email: string, now = Date.now()): number {
    const list = this.recent(this.key(ip, email), now);
    if (list.length < this.maxFailures) return 0;
    return Math.ceil((list[0]! + this.windowMs - now) / 1000);
  }

  recordFailure(ip: string, email: string, now = Date.now()) {
    const k = this.key(ip, email);
    this.failures.set(k, [...this.recent(k, now), now]);
    if (this.failures.size > 10_000) this.prune(now);
  }

  reset(ip: string, email: string) {
    this.failures.delete(this.key(ip, email));
  }

  private prune(now: number) {
    for (const k of this.failures.keys()) this.recent(k, now);
  }
}
