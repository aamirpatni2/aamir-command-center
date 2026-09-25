import { describe, expect, it } from "vitest";
import { checkContent, contentDraftSchema, renderContent } from "./content.js";

const reel = {
  title: "3 AI tools freelancers ke liye",
  durationSec: 45,
  hook: "Yeh 3 AI tools aap ka kaam aadha kar denge.",
  beats: [{ start: 3, end: 15, voiceover: "Pehla tool: Claude — script 10 minute mein.", onScreenText: "Tool #1: Claude" }],
  cta: "Save karo aur follow karo",
  caption: "Kaunsa tool aap use karte ho? Comment karo 👇",
  hashtags: ["AIinUrdu", "#PakistaniFreelancer"],
};

describe("content formats", () => {
  it("validates a reel and rejects a malformed one", () => {
    expect(contentDraftSchema.safeParse({ type: "reel", data: reel }).success).toBe(true);
    expect(contentDraftSchema.safeParse({ type: "reel", data: { ...reel, beats: [] } }).success).toBe(false);
    expect(contentDraftSchema.safeParse({ type: "tweetstorm", data: {} }).success).toBe(false);
    expect(contentDraftSchema.safeParse({ type: "image_prompt", data: { prompt: "short", aspectRatio: "9:16" } }).success).toBe(false);
  });
  it("renders readable text", () => {
    const text = renderContent("reel", reel);
    expect(text).toContain("HOOK (0–3s): Yeh 3 AI tools");
    expect(text).toContain("#AIinUrdu #PakistaniFreelancer");
  });
});

describe("content checks", () => {
  const codes = (text: string, language: "ur" | "ur-roman" | "en" = "ur-roman", hasSources = false) =>
    checkContent({ type: "post", language, text, hasSources }).map((c) => c.code);

  it("clean Roman Urdu passes", () => {
    expect(codes("Yaar, yeh tool aap ka kaam asaan kar dega. Aaj hi try karo!")).toEqual([]);
  });
  it("flags language mismatch both ways", () => {
    expect(codes("Yeh tool bohat acha hai", "ur")).toContain("LANGUAGE");
    expect(codes("یہ ٹول بہت اچھا ہے اور آپ کا کام آسان کر دے گا", "ur-roman")).toContain("LANGUAGE");
    expect(codes("یہ ٹول بہت اچھا ہے اور آپ کا کام آسان کر دے گا", "ur")).toEqual([]);
  });
  it("flags AI-isms, Hindi words, income, guarantees, scarcity, unsourced stats", () => {
    expect(codes("Let's delve into this comprehensive guide")).toContain("AI_ISM");
    expect(codes("Aap ka dhanyavaad")).toContain("HINDI_WORD");
    expect(codes("ChatGPT se Rs. 80,000 mahine kamao")).toContain("INCOME_CLAIM");
    expect(codes("Freelancers earn $500 per month with this")).toContain("INCOME_CLAIM");
    expect(codes("100% guaranteed results")).toContain("GUARANTEE");
    expect(codes("Sirf 5 seats baqi, last chance!")).toContain("SCARCITY");
    expect(codes("70% freelancers yeh tool use nahi karte")).toContain("UNSOURCED_STAT");
    expect(codes("70% freelancers yeh tool use nahi karte", "ur-roman", true)).not.toContain("UNSOURCED_STAT");
  });
  it("image prompts are English by design (no language warning)", () => {
    expect(checkContent({ type: "image_prompt", language: "ur", text: "A young Pakistani student at a laptop", hasSources: false })).toEqual([]);
  });
});
