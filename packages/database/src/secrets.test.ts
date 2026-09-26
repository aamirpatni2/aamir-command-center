import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secrets.js";

describe("token encryption", () => {
  const key = "test-encryption-key-0123456789abcdef";
  it("round-trips, never stores the plain value, and uses a fresh IV each time", () => {
    const a = encryptSecret("ya29.secret-refresh-token", key);
    const b = encryptSecret("ya29.secret-refresh-token", key);
    expect(a).not.toContain("secret-refresh-token");
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("ya29.secret-refresh-token");
  });
  it("fails on a wrong key or tampering", () => {
    const a = encryptSecret("token", key);
    expect(() => decryptSecret(a, "another-key-0123456789abcdef")).toThrow();
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret("plain-text", key)).toThrow();
  });
});
