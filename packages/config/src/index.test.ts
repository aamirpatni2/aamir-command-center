import { describe, expect, it } from "vitest";
import { envSchema, integrationStatus } from "./index.js";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  SESSION_SECRET: "a".repeat(40),
  ACC_ENCRYPTION_KEY: "b".repeat(40),
};

describe("envSchema", () => {
  it("applies defaults", () => {
    const env = envSchema.parse(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.WEB_ORIGINS).toEqual(["http://localhost:5173"]);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("rejects placeholder secrets in production", () => {
    const r = envSchema.safeParse({ ...base, NODE_ENV: "production", SESSION_SECRET: "change-me-generate-a-random-value" });
    expect(r.success).toBe(false);
  });

  it("rejects mocks in production", () => {
    const r = envSchema.safeParse({ ...base, NODE_ENV: "production", ACC_ENABLE_MOCKS: "true" });
    expect(r.success).toBe(false);
  });

  it("production requires HTTPS URLs and separate secrets", () => {
    const prod = { ...base, NODE_ENV: "production", PUBLIC_URL: "https://acc.example.com", WEB_ORIGINS: "https://acc.example.com" };
    expect(envSchema.safeParse(prod).success).toBe(true);
    expect(envSchema.safeParse({ ...prod, PUBLIC_URL: "http://acc.example.com" }).success).toBe(false);
    expect(envSchema.safeParse({ ...prod, WEB_ORIGINS: "https://acc.example.com,http://evil.test" }).success).toBe(false);
    expect(envSchema.safeParse({ ...prod, ACC_ENCRYPTION_KEY: base.SESSION_SECRET }).success).toBe(false);
  });

  it("rejects a malformed Meta ad account id (it's used in API paths)", () => {
    expect(envSchema.safeParse({ ...base, META_AD_ACCOUNT_ID: "act_1234567890" }).success).toBe(true);
    expect(envSchema.safeParse({ ...base, META_AD_ACCOUNT_ID: "123/../../me" }).success).toBe(false);
  });

  it("requires DATABASE_URL", () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(envSchema.safeParse(rest).success).toBe(false);
  });
});

describe("integrationStatus", () => {
  it("reports booleans only, never values", () => {
    const s = integrationStatus({ ANTHROPIC_API_KEY: "sk-ant-secret", WHATSAPP_ACCESS_TOKEN: "x" });
    expect(s.anthropic).toBe(true);
    expect(s.whatsapp).toBe(false);
    expect(JSON.stringify(s)).not.toContain("sk-ant-secret");
  });
});
