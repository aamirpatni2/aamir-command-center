import { describe, expect, it } from "vitest";
import { automationJobId } from "./queue.js";

describe("automation job ids", () => {
  it("never contain ':' (BullMQ rejects them) and stay unique per event", () => {
    const a = automationJobId("whatsapp.message_received", "8f1c2a8e-0000-4000-8000-000000000001");
    const b = automationJobId("rule-id", "manual:1790000000000");
    expect(a).not.toContain(":");
    expect(b).not.toContain(":");
    expect(a).not.toBe(automationJobId("lead.created", "8f1c2a8e-0000-4000-8000-000000000001"));
  });
});
