#!/usr/bin/env node
/**
 * Secret-leak check for every file tracked by git (run in CI and before pushing):
 *   pnpm security:secrets
 * Looks for real-looking credentials, committed .env files and filled-in secrets in .env.example.
 * Findings print masked (never the full value) and exit with code 1.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

export const PATTERNS = [
  ["Anthropic API key", /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["Google OAuth client secret", /\bGOCSPX-[A-Za-z0-9_-]{20,}/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ["Meta access token", /\bEAA[A-Za-z0-9]{60,}\b/g],
  ["Slack token", /\bxox[abpr]-[A-Za-z0-9-]{20,}/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["Tavily API key", /\btvly-[A-Za-z0-9]{20,}/g],
  ["Voyage API key", /\bpa-[A-Za-z0-9_-]{40,}/g],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
];

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PRIVATE)[A-Z_]*$/;
const mask = (s) => (s.length <= 10 ? "***" : `${s.slice(0, 6)}…${s.slice(-2)} (${s.length} chars)`);

/** @returns {{file: string, line: number, kind: string, sample: string}[]} */
export function scan(root, files) {
  const findings = [];
  for (const file of files) {
    const base = file.split("/").pop();
    if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") {
      findings.push({ file, line: 0, kind: "Committed .env file", sample: base });
      continue;
    }
    let text;
    try {
      const path = resolve(root, file);
      if (statSync(path).size > 1_000_000) continue;
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue; // binary
    const lines = text.split("\n");
    lines.forEach((l, i) => {
      for (const [kind, re] of PATTERNS) {
        for (const m of l.matchAll(re)) findings.push({ file, line: i + 1, kind, sample: mask(m[0]) });
      }
      if (base === ".env.example") {
        const m = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(l.trim());
        if (m && SECRET_NAME.test(m[1]) && !/^(change-me|<.*>|dev-local-secret|your-)/i.test(m[2])) {
          findings.push({ file, line: i + 1, kind: `Value filled in for ${m[1]}`, sample: mask(m[2]) });
        }
      }
    });
  }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\u0000").filter(Boolean);
  const findings = scan(root, files);
  if (findings.length) {
    console.error(`✖ ${findings.length} possible secret(s) in tracked files:`);
    for (const f of findings) console.error(`  ${f.file}${f.line ? `:${f.line}` : ""}  ${f.kind}  ${f.sample}`);
    process.exit(1);
  }
  console.log(`✔ no secrets found in ${files.length} tracked files`);
}
