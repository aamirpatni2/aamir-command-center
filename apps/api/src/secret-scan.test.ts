import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
// @ts-ignore -- plain ESM script with a .d.mts next to it
import { scan } from "../../../scripts/secret-scan.mjs";

// Fake credentials are assembled at runtime so this file never contains one itself.
const fake = {
  anthropic: ["sk", "ant", "api03"].join("-") + "-" + "A".repeat(40),
  github: "gh" + "p_" + "b".repeat(36),
  meta: "E" + "AA" + "c".repeat(70),
  google: "AI" + "za" + "d".repeat(35),
  key: ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" "),
};

describe("secret scanner", () => {
  it("finds planted secrets, committed .env files and filled-in examples, and masks them", () => {
    const dir = mkdtempSync(join(tmpdir(), "acc-secrets-"));
    writeFileSync(join(dir, "config.ts"), `const a = "${fake.anthropic}";\nconst b = "${fake.github}";\n`);
    writeFileSync(join(dir, "notes.md"), `token: ${fake.meta}\nmaps: ${fake.google}\n${fake.key}\n`);
    writeFileSync(join(dir, ".env"), "SESSION_SECRET=x\n");
    writeFileSync(join(dir, ".env.example"), "ANTHROPIC_API_KEY=real-looking-value-123\nSESSION_SECRET=change-me-generate-a-random-value\nPUBLIC_URL=http://localhost:5173\n");
    const findings = scan(dir, ["config.ts", "notes.md", ".env", ".env.example"]);
    const kinds = findings.map((f: { kind: string }) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining([
      "Anthropic API key", "GitHub token", "Meta access token", "Google API key", "Private key", "Committed .env file", "Value filled in for ANTHROPIC_API_KEY",
    ]));
    expect(kinds).not.toContain("Value filled in for SESSION_SECRET");
    expect(JSON.stringify(findings)).not.toContain(fake.anthropic);
  });

  it("the repository itself is clean", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\u0000").filter(Boolean);
    expect(scan(root, files)).toEqual([]);
  });
});
