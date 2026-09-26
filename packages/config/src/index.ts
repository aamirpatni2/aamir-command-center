/**
 * Server-side environment configuration. Never import this from browser code.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const PLACEHOLDER = "change-me-generate-a-random-value";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v : undefined));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    API_HOST: z.string().default("0.0.0.0"),
    API_PORT: z.coerce.number().int().positive().default(4000),
    WEB_ORIGINS: z
      .string()
      .default("http://localhost:5173")
      .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

    DATABASE_URL: z.string().url(),
    TEST_DATABASE_URL: optionalString,
    REDIS_URL: z.string().url().default("redis://localhost:6379"),

    SESSION_SECRET: z.string().min(16),
    ACC_ENCRYPTION_KEY: z.string().min(16),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
    SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().positive().default(30),

    ANTHROPIC_API_KEY: optionalString,
    DEFAULT_MODEL_PROVIDER: z.enum(["anthropic", "openai", "google"]).default("anthropic"),
    DEFAULT_MODEL: z.string().default("claude-opus-5"),
    OPENAI_API_KEY: optionalString,
    GOOGLE_AI_API_KEY: optionalString,

    WHATSAPP_ACCESS_TOKEN: optionalString,
    WHATSAPP_PHONE_NUMBER_ID: optionalString,
    WHATSAPP_BUSINESS_ACCOUNT_ID: optionalString,
    WHATSAPP_APP_SECRET: optionalString,
    WHATSAPP_VERIFY_TOKEN: optionalString,
    WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v21.0"),
    /** Run the WhatsApp Agent automatically on new inbound messages (drafts only; sending needs approval). */
    WHATSAPP_AUTO_TRIAGE: z
      .string()
      .optional()
      .transform((v) => v !== "false"),
    /** Wait this long after a message before triage, so bursts of messages are handled together. */
    WHATSAPP_TRIAGE_DELAY_SECONDS: z.coerce.number().int().min(0).max(3600).default(45),

    /** Public base URL of the dashboard (OAuth redirects come back to <PUBLIC_URL>/api/integrations/oauth/callback). */
    PUBLIC_URL: z.string().url().default("http://localhost:5173"),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    CANVA_CLIENT_ID: optionalString,
    CANVA_CLIENT_SECRET: optionalString,
    /** Read by mcp.config.json (${env:GITHUB_TOKEN}); fine-grained, read-only. */
    GITHUB_TOKEN: optionalString,
    MCP_CONFIG: optionalString,

    /** Meta Marketing API, read-only (ads_read): campaign results on the Ads page. */
    META_ADS_ACCESS_TOKEN: optionalString,
    META_AD_ACCOUNT_ID: optionalString,

    BRAVE_API_KEY: optionalString,
    TAVILY_API_KEY: optionalString,
    VOYAGE_API_KEY: optionalString,
    EMBEDDING_MODEL: z.string().default("voyage-3.5"),

    ACC_ENABLE_MOCKS: z
      .string()
      .optional()
      .transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    for (const key of ["SESSION_SECRET", "ACC_ENCRYPTION_KEY"] as const) {
      if (env[key] === PLACEHOLDER || env[key].length < 32) {
        ctx.addIssue({ code: "custom", path: [key], message: "must be a real random secret (32+ chars) in production" });
      }
    }
    if (env.ACC_ENABLE_MOCKS) {
      ctx.addIssue({ code: "custom", path: ["ACC_ENABLE_MOCKS"], message: "mocks cannot be enabled in production" });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Walks up from cwd to find the repo-root .env (monorepo packages run from their own dir). */
function findDotenv(start = process.cwd()): string | undefined {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

let cached: Env | undefined;

export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const path = findDotenv();
  if (path) loadDotenv({ path, quiet: true });
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (Object.keys(overrides).length === 0) cached = parsed.data;
  return parsed.data;
}

/** Which integrations have credentials. Values are never exposed — only booleans. */
export function integrationStatus(env: NodeJS.ProcessEnv = process.env) {
  const has = (...keys: string[]) => keys.every((k) => !!env[k] && env[k]!.trim() !== "");
  return {
    anthropic: has("ANTHROPIC_API_KEY"),
    openai: has("OPENAI_API_KEY"),
    google_ai: has("GOOGLE_AI_API_KEY"),
    whatsapp: has("WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"),
    web_search: has("BRAVE_API_KEY") || has("TAVILY_API_KEY"),
    embeddings: has("VOYAGE_API_KEY"),
    google_workspace: has("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
    canva: has("CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET"),
    meta_ads: has("META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"),
    notion: has("NOTION_TOKEN"),
  } as const;
}
