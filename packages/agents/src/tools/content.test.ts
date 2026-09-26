import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema, type DbHandle } from "@acc/database";
import { MockProvider } from "../model/mock.js";
import { createDefaultToolRegistry } from "../index.js";
import { MemoryEventSink } from "../runtime/events.js";
import { orchestrate } from "../orchestration/orchestrate.js";
import { createTask, setupDb, silentLogger } from "../test/helpers.js";

let h: DbHandle;
beforeAll(async () => (h = await setupDb()));
afterAll(async () => h?.close());

const finish = (input: object) => ({ toolCalls: [{ name: "finish", input }] });

describe("Content Agent through the orchestrator", () => {
  it("saves validated drafts linked to the task; invalid formats come back as errors to fix", async () => {
    const task = await createTask(h, "Ek Reel script aur ek thumbnail image prompt banao: Claude vs ChatGPT");
    const mock = new MockProvider([
      finish({ intent: "Reel + thumbnail", language: "ur-roman", steps: [{ agent: "content", instruction: "Write a 45s Reel and a thumbnail image prompt.", acceptance: "One reel and one image prompt saved as drafts", dependsOn: [] }] }),
      { toolCalls: [{ name: "content.search", input: { query: "Claude" } }] },
      // First attempt: reel without beats → rejected by the format.
      { toolCalls: [{ name: "content.save", input: { type: "reel", language: "ur-roman", data: { title: "Claude vs ChatGPT", durationSec: 45, hook: "Kaun behtar hai?", beats: [], cta: "Follow karo", caption: "?" } } }] },
      (req) => {
        expect(JSON.stringify(req.messages.at(-1))).toContain("INVALID_INPUT");
        return {
          toolCalls: [
            { name: "content.save", input: { type: "reel", language: "ur-roman", platform: "facebook", data: { title: "Claude vs ChatGPT", durationSec: 45, hook: "Kaun behtar hai? Main ne test kiya.", beats: [{ start: 3, end: 40, voiceover: "Dono ko ek hi task diya." }], cta: "Follow karo", caption: "Aap kya use karte ho?", hashtags: ["AIinUrdu"] } } },
            { name: "content.save", input: { type: "image_prompt", language: "en", data: { prompt: "Split screen: two AI chat windows, Pakistani creator pointing, bold contrast", aspectRatio: "16:9", textOverlay: "Claude vs ChatGPT?" } } },
          ],
        };
      },
      finish({ summary: "Saved a reel and a thumbnail prompt", output: "2 drafts saved", sources: [], unverifiedClaims: [], blockers: [] }),
      finish({ answer: "Do drafts review ke liye tayar hain.", issues: [], nextSteps: ["Review in Content"] }),
    ]);
    const res = await orchestrate({ id: task.id, input: task.input }, {
      db: h.db, tools: createDefaultToolRegistry(), events: new MemoryEventSink(), logger: silentLogger,
      resolve: () => ({ provider: mock, model: "mock" }),
    });
    expect(res.status).toBe("COMPLETED");
    const items = await h.db.select().from(schema.contentItems).where(eq(schema.contentItems.sourceTaskId, task.id));
    expect(items.map((i) => [i.type, i.status])).toEqual([["reel", "draft"], ["image_prompt", "draft"]]);
    expect((items[0]!.data as { createdBy: string }).createdBy).toBe("agent");
    // Content agent has exactly its granted tools.
    expect(mock.calls[1]!.tools.map((t) => t.name).sort()).toEqual(["content.save", "content.search", "course.catalog", "finish", "kb.search"]);
  });

  it("returns checks to the agent so it can fix flagged claims", async () => {
    const reg = createDefaultToolRegistry();
    const task = await createTask(h);
    const [run] = await h.db.insert(schema.agentRuns).values({ taskId: task.id, agentId: "content" }).returning();
    const r = await reg.execute(["content.save"], { id: "x", name: "content.save", input: { type: "caption", language: "ur-roman", data: { text: "ChatGPT se Rs. 1 lakh mahine kamao, 100% guaranteed" } } }, {
      db: h.db, taskId: task.id, runId: run!.id, agentId: "content", toolCallId: "x",
    });
    const checks = (r as { output: { checks: { code: string }[] } }).output.checks.map((c) => c.code);
    expect(checks).toEqual(expect.arrayContaining(["INCOME_CLAIM", "GUARANTEE"]));
  });
});
