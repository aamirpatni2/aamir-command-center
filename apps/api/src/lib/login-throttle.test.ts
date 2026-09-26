import { describe, expect, it } from "vitest";
import { LoginThrottle } from "./login-throttle.js";
import { MemoryWindowStore } from "./window-store.js";

describe("LoginThrottle", () => {
  it("blocks after max failures and unblocks when the window passes", async () => {
    const t = new LoginThrottle(new MemoryWindowStore(), 2, 1000);
    await t.recordFailure("1.1.1.1", "A@x.test", 0);
    expect(await t.retryAfter("1.1.1.1", "a@x.test", 10)).toBe(0);
    await t.recordFailure("1.1.1.1", "a@x.test", 100);
    expect(await t.retryAfter("1.1.1.1", "a@x.test", 200)).toBe(1);
    expect(await t.retryAfter("2.2.2.2", "a@x.test", 200)).toBe(0); // other IP unaffected
    expect(await t.retryAfter("1.1.1.1", "a@x.test", 1001)).toBe(0); // first failure expired
  });
  it("reset clears failures", async () => {
    const t = new LoginThrottle(new MemoryWindowStore(), 1, 1000);
    await t.recordFailure("ip", "e", 0);
    await t.reset("ip", "e");
    expect(await t.retryAfter("ip", "e", 1)).toBe(0);
  });
});
