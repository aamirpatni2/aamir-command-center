import { describe, expect, it } from "vitest";
import { LoginThrottle } from "./login-throttle.js";

describe("LoginThrottle", () => {
  it("blocks after max failures and unblocks when the window passes", () => {
    const t = new LoginThrottle(2, 1000);
    t.recordFailure("1.1.1.1", "A@x.test", 0);
    expect(t.retryAfter("1.1.1.1", "a@x.test", 10)).toBe(0);
    t.recordFailure("1.1.1.1", "a@x.test", 100);
    expect(t.retryAfter("1.1.1.1", "a@x.test", 200)).toBe(1);
    expect(t.retryAfter("2.2.2.2", "a@x.test", 200)).toBe(0); // other IP unaffected
    expect(t.retryAfter("1.1.1.1", "a@x.test", 1001)).toBe(0); // first failure expired
  });
  it("reset clears failures", () => {
    const t = new LoginThrottle(1, 1000);
    t.recordFailure("ip", "e", 0);
    t.reset("ip", "e");
    expect(t.retryAfter("ip", "e", 1)).toBe(0);
  });
});
