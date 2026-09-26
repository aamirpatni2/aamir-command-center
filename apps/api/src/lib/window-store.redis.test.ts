import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AgentRunLimiter } from "./rate-limits.js";
import { LoginThrottle } from "./login-throttle.js";
import { MemoryWindowStore, RedisWindowStore, type WindowStore } from "./window-store.js";

const REDIS = process.env.REDIS_URL ?? "redis://localhost:6379";
const prefix = `acc:test:${randomUUID()}:`;
const stores: RedisWindowStore[] = [];
const redisStore = () => {
  const s = new RedisWindowStore(REDIS, prefix);
  stores.push(s);
  return s;
};
afterAll(async () => {
  const keys = await stores[0]!.redis.keys(`${prefix}*`);
  if (keys.length) await stores[0]!.redis.del(...keys);
  await Promise.all(stores.map((s) => s.close()));
});

describe.each([
  ["memory", () => new MemoryWindowStore() as WindowStore],
  ["redis", () => redisStore() as WindowStore],
])("%s window store", (_name, make) => {
  it("take allows up to max inside the window, then reports the wait", async () => {
    const s = make();
    const k = randomUUID();
    expect(await s.take(k, 2, 10_000, 1_000)).toMatchObject({ allowed: true, count: 1 });
    expect(await s.take(k, 2, 10_000, 2_000)).toMatchObject({ allowed: true, count: 2 });
    expect(await s.take(k, 2, 10_000, 3_000)).toEqual({ allowed: false, count: 2, retryAfter: 8 });
    // The first event leaves the window at 11s.
    expect(await s.take(k, 2, 10_000, 11_001)).toMatchObject({ allowed: true });
  });

  it("add / peek / clear", async () => {
    const s = make();
    const k = randomUUID();
    await s.add(k, 5_000, 0);
    await s.add(k, 5_000, 1_000);
    expect(await s.peek(k, 5_000, 2_000)).toEqual({ count: 2, retryAfter: 3 });
    expect(await s.peek(k, 5_000, 5_500)).toEqual({ count: 1, retryAfter: 1 });
    await s.clear(k);
    expect(await s.peek(k, 5_000, 5_500)).toEqual({ count: 0, retryAfter: 0 });
  });
});

describe("Redis-backed limits", () => {
  it("an API restart (new client) keeps the agent-run budget and failed-login count", async () => {
    const user = randomUUID();
    const before = new AgentRunLimiter(redisStore(), 2, 3600_000);
    expect(await before.take(user)).toBe(0);
    expect(await before.take(user)).toBe(0);
    const after = new AgentRunLimiter(redisStore(), 2, 3600_000);
    expect(await after.take(user)).toBeGreaterThan(3500);

    const email = `${randomUUID()}@x.test`;
    await new LoginThrottle(redisStore(), 2, 900_000).recordFailure("1.2.3.4", email);
    await new LoginThrottle(redisStore(), 2, 900_000).recordFailure("1.2.3.4", email);
    expect(await new LoginThrottle(redisStore(), 2, 900_000).retryAfter("1.2.3.4", email)).toBeGreaterThan(800);
  });

  it("concurrent requests can't overshoot the budget (atomic check-and-record)", async () => {
    const s = redisStore();
    const k = randomUUID();
    const results = await Promise.all(Array.from({ length: 20 }, () => s.take(k, 5, 60_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
