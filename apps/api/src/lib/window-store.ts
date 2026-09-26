/**
 * Sliding-window counters for throttles (failed logins, agent runs). Redis-backed so limits hold
 * across API restarts and several API instances; the in-memory store is for tests.
 */
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

export interface WindowResult {
  /** Events inside the window (after this call). */
  count: number;
  /** Seconds until the oldest event leaves the window (0 when empty). */
  retryAfter: number;
}

export interface WindowStore {
  /** Records an event only if fewer than `max` are in the window. Atomic. */
  take(key: string, max: number, windowMs: number, now?: number): Promise<WindowResult & { allowed: boolean }>;
  /** Records an event unconditionally. */
  add(key: string, windowMs: number, now?: number): Promise<void>;
  peek(key: string, windowMs: number, now?: number): Promise<WindowResult>;
  clear(key: string): Promise<void>;
  close(): Promise<void>;
}

const retryAfter = (oldest: number | undefined, windowMs: number, now: number) =>
  oldest === undefined ? 0 : Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));

export class MemoryWindowStore implements WindowStore {
  private events = new Map<string, number[]>();

  private recent(key: string, windowMs: number, now: number) {
    const list = (this.events.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length) this.events.set(key, list);
    else this.events.delete(key);
    return list;
  }

  async take(key: string, max: number, windowMs: number, now = Date.now()) {
    const list = this.recent(key, windowMs, now);
    if (list.length >= max) return { allowed: false, count: list.length, retryAfter: retryAfter(list[0], windowMs, now) };
    list.push(now);
    this.events.set(key, list);
    return { allowed: true, count: list.length, retryAfter: 0 };
  }

  async add(key: string, windowMs: number, now = Date.now()) {
    this.events.set(key, [...this.recent(key, windowMs, now), now]);
  }

  async peek(key: string, windowMs: number, now = Date.now()) {
    const list = this.recent(key, windowMs, now);
    return { count: list.length, retryAfter: list.length ? retryAfter(list[0], windowMs, now) : 0 };
  }

  async clear(key: string) {
    this.events.delete(key);
  }

  async close() {}
}

// KEYS[1] = key; ARGV = now, windowMs, max (-1 = unconditional), member. Returns {allowed, count, oldest}.
const SCRIPT = `
local key, now, win, max = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - win)
local n = redis.call('ZCARD', key)
local allowed = 0
if max < 0 or n < max then
  redis.call('ZADD', key, now, ARGV[4])
  redis.call('PEXPIRE', key, win)
  n = n + 1
  allowed = 1
end
local first = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldest = -1
if first[2] then oldest = tonumber(first[2]) end
return {allowed, n, oldest}
`;

export class RedisWindowStore implements WindowStore {
  readonly redis: Redis;
  private ownsClient: boolean;

  constructor(
    redis: Redis | string,
    private readonly prefix = "acc:limits:",
  ) {
    this.ownsClient = typeof redis === "string";
    this.redis = typeof redis === "string" ? new Redis(redis, { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false }) : redis;
  }

  private async run(key: string, max: number, windowMs: number, now: number) {
    const [allowed, count, oldest] = (await this.redis.eval(SCRIPT, 1, this.prefix + key, now, windowMs, max, `${now}:${randomUUID()}`)) as [number, number, number];
    return { allowed: allowed === 1, count, oldest: oldest < 0 ? undefined : oldest };
  }

  async take(key: string, max: number, windowMs: number, now = Date.now()) {
    const r = await this.run(key, max, windowMs, now);
    return { allowed: r.allowed, count: r.count, retryAfter: r.allowed ? 0 : retryAfter(r.oldest, windowMs, now) };
  }

  async add(key: string, windowMs: number, now = Date.now()) {
    await this.run(key, -1, windowMs, now);
  }

  async peek(key: string, windowMs: number, now = Date.now()) {
    const k = this.prefix + key;
    await this.redis.zremrangebyscore(k, "-inf", now - windowMs);
    const [count, first] = await Promise.all([this.redis.zcard(k), this.redis.zrange(k, 0, 0, "WITHSCORES")]);
    return { count, retryAfter: count ? retryAfter(first[1] === undefined ? undefined : Number(first[1]), windowMs, now) : 0 };
  }

  async clear(key: string) {
    await this.redis.del(this.prefix + key);
  }

  async close() {
    if (this.ownsClient) await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
