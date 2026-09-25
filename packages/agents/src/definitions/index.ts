import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentId } from "@acc/shared";
import type { AgentDefinition } from "./types.js";

const PROMPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../agents");
const prompt = (id: AgentId) => readFileSync(resolve(PROMPTS_DIR, id, "prompt.md"), "utf8").trim();

export const orchestrator: AgentDefinition = {
  id: "orchestrator",
  description: "Understands the request, plans, delegates to specialists and summarises the result.",
  systemPrompt: prompt("orchestrator"),
  effort: "high",
  tools: ["kb.search", "memory.propose"],
  maxSteps: 8,
};

/** Specialist agents are added milestone by milestone (see docs/IMPLEMENTATION_PLAN.md). */
export const AGENTS: Partial<Record<AgentId, AgentDefinition>> = { orchestrator };

export type { AgentDefinition } from "./types.js";
