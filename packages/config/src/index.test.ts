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
