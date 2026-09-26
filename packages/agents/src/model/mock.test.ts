import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock.js";

describe("MockProvider demo", () => {
  it("reads the request from specialist inputs (not the date line)", async () => {
    const mock = new MockProvider();
    const res = await mock.generate({
      model: "mock", system: "s",
      tools: [{ name: "content.save", description: "", inputSchema: { type: "object" } }, { name: "finish", description: "", inputSchema: { type: "object", properties: { output: {}, summary: {} } } }],
      messages: [{ role: "user", content: "Today is Saturday.\n\nYou are handling step 1 of 1.\n\nOriginal request from Aamir (context only):\nReel: Claude vs ChatGPT" }],
    });
    expect((res.toolCalls[0]!.input as { data: { title: string } }).data.title).toBe("[MOCK] Reel: Claude vs ChatGPT");
  });
});
