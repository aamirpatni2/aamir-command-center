/**
 * MCP server configuration (mcp.config.json at the repo root, or MCP_CONFIG). Servers are only
 * defined in this file, never through the UI: a stdio server runs a command on the host.
 *
 * Only tools listed under `tools` are exposed, each with an explicit risk level and the agents that
 * may use it. Server-side "readOnly" hints are shown for information but never trusted.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AGENT_IDS, TOOL_RISKS } from "@acc/shared";

const toolPolicy = z.object({
  risk: z.enum(TOOL_RISKS),
  agents: z.array(z.enum(AGENT_IDS)).default([]),
  /** Optional override of the description shown to agents. */
  description: z.string().max(500).optional(),
});

const common = {
  id: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/, "lowercase letters, digits and dashes"),
  label: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
  enabled: z.boolean().default(true),
  /** Environment variables that must be set before connecting (names only; values never leave the server). */
  requires: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default([]),
  tools: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/).refine((n) => !n.includes("__"), "no double underscores"), toolPolicy).default({}),
};

export const mcpServerSchema = z.discriminatedUnion("transport", [
  z.object({ ...common, transport: z.literal("stdio"), command: z.string().min(1), args: z.array(z.string()).default([]), env: z.record(z.string(), z.string()).default({}) }),
  z.object({ ...common, transport: z.literal("http"), url: z.string().url(), headers: z.record(z.string(), z.string()).default({}) }),
]);
export type McpServerConfig = z.infer<typeof mcpServerSchema>;

export const mcpConfigSchema = z.object({ servers: z.array(mcpServerSchema).max(20).default([]) }).superRefine((c, ctx) => {
  const seen = new Set<string>();
  c.servers.forEach((s, i) => {
    if (seen.has(s.id)) ctx.addIssue({ code: "custom", path: ["servers", i, "id"], message: `duplicate server id "${s.id}"` });
    seen.add(s.id);
  });
});
export type McpConfig = z.infer<typeof mcpConfigSchema>;

/**
 * Substitutes `${root}` (repo root) and `${env:NAME}` (environment variable) in strings.
 * Secrets therefore live in .env, never in the config file.
 */
export function expand(value: string, root: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{root\}/g, root).replace(/\$\{env:([A-Z][A-Z0-9_]*)\}/g, (_m, name: string) => env[name] ?? "");
}

export function loadMcpConfig(path: string): McpConfig {
  if (!existsSync(path)) return { servers: [] };
  const parsed = mcpConfigSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`Invalid MCP config ${path}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

/** Repository root (this file lives in packages/agents/src/mcp). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const defaultMcpConfigPath = (root: string, env: NodeJS.ProcessEnv) => resolve(root, env.MCP_CONFIG ?? "mcp.config.json");
