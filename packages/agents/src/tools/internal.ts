/**
 * Internal tools backed by our own database. Real implementations — no mocks.
 */
import { z } from "zod";
import { schema } from "@acc/database";
import { makeKbSearch } from "./research.js";
import type { Tool } from "./types.js";

/** Keyword search over APPROVED knowledge only. Vector search replaces this in Milestone 8. */
/** Default kb.search without semantic search (tests, and when no embedder is configured). */
export const kbSearch = makeKbSearch(null);

/** Agents can PROPOSE long-term memory; only a human approves it into trusted memory. */
export const memoryPropose: Tool<{ kind: "fact" | "preference" | "decision" | "event"; subject: string; content: string; confidence?: number }, unknown> = {
  name: "memory.propose",
  description:
    "Propose something worth remembering long-term (a fact, preference, decision or event). " +
    "It is stored as 'proposed' and is not trusted until Aamir approves it.",
  risk: "draft",
  input: z.object({
    kind: z.enum(["fact", "preference", "decision", "event"]),
    subject: z.string().min(1).max(120),
    content: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1).optional(),
  }),
  async run(input, { db, runId }) {
    const [row] = await db
      .insert(schema.memoryItems)
      .values({ ...input, source: "agent", status: "proposed", sourceRunId: runId })
      .returning({ id: schema.memoryItems.id });
    return { id: row!.id, status: "proposed" };
  },
};

export const INTERNAL_TOOLS = [kbSearch, memoryPropose];
