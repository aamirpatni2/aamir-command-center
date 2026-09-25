/**
 * Content formats (structured, validated) and automatic quality checks.
 * Every agent-generated content item is one of these shapes; checks run on save and on every edit.
 */
import { z } from "zod";
import { CONTENT_LANGUAGES } from "./statuses.js";

const hashtags = z.array(z.string().regex(/^#?[\p{L}\p{N}_]{1,60}$/u)).max(30).default([]);
const aspect = z.enum(["1:1", "4:5", "9:16", "16:9"]);

export const CONTENT_FORMATS = {
  idea: z.object({
    title: z.string().min(3).max(200),
    angle: z.string().min(3).max(500),
    whyItWorks: z.string().min(3).max(500).describe("What fear, curiosity or desire it triggers for Pakistani students/freelancers"),
    bestFor: z.enum(["youtube", "reel", "post", "carousel"]),
    keywords: z.array(z.string().max(60)).max(8).default([]),
  }),
  hook: z.object({
    text: z.string().min(3).max(300),
    framework: z.string().max(80).optional().describe("e.g. 'B4 Question hook'"),
  }),
  reel: z.object({
    title: z.string().min(3).max(200),
    durationSec: z.number().int().min(10).max(180),
    hook: z.string().min(3).max(300).describe("Spoken line for the first 3 seconds"),
    beats: z
      .array(
        z.object({
          start: z.number().min(0).max(180),
          end: z.number().min(0).max(180),
          voiceover: z.string().min(1).max(600),
          onScreenText: z.string().max(120).optional(),
          visual: z.string().max(300).optional(),
        }),
      )
      .min(1)
      .max(15),
    cta: z.string().min(2).max(200),
    caption: z.string().min(2).max(2200),
    hashtags,
  }),
  script: z.object({
    title: z.string().min(3).max(200),
    thumbnailText: z.string().max(60).optional(),
    thumbnailVisual: z.string().max(300).optional(),
    sections: z
      .array(z.object({ heading: z.string().max(120), timing: z.string().max(30).optional(), content: z.string().min(1).max(8000), broll: z.string().max(500).optional() }))
      .min(1)
      .max(20),
    cta: z.string().min(2).max(500),
  }),
  caption: z.object({ text: z.string().min(1).max(2200), hashtags }),
  post: z.object({
    text: z.string().min(1).max(5000),
    hashtags,
    imageIdea: z.string().max(500).optional(),
  }),
  carousel: z.object({
    slides: z.array(z.object({ heading: z.string().max(120), text: z.string().max(600) })).min(2).max(12),
    caption: z.string().min(1).max(2200),
    hashtags,
  }),
  image_prompt: z.object({
    prompt: z.string().min(10).max(2000),
    aspectRatio: aspect,
    style: z.string().max(200).optional(),
    negativePrompt: z.string().max(500).optional(),
    textOverlay: z.string().max(120).optional(),
  }),
  video_prompt: z.object({
    prompt: z.string().min(10).max(2000),
    durationSec: z.number().int().min(2).max(120),
    aspectRatio: aspect,
    camera: z.string().max(300).optional(),
    style: z.string().max(200).optional(),
    audio: z.string().max(300).optional(),
  }),
} as const;

export type ContentType = keyof typeof CONTENT_FORMATS;
export const CONTENT_TYPES = Object.keys(CONTENT_FORMATS) as [ContentType, ...ContentType[]];
export const CONTENT_PLATFORMS = ["youtube", "facebook", "instagram", "tiktok", "whatsapp", "x", "linkedin", "other"] as const;

/** Discriminated union used by the content.save tool and the API. */
export const contentDraftSchema = z.discriminatedUnion(
  "type",
  CONTENT_TYPES.map((t) => z.object({ type: z.literal(t), data: CONTENT_FORMATS[t] })) as unknown as [
    z.ZodObject<{ type: z.ZodLiteral<ContentType>; data: z.ZodTypeAny }>,
    ...z.ZodObject<{ type: z.ZodLiteral<ContentType>; data: z.ZodTypeAny }>[],
  ],
);

/** Plain-text rendering used for the body column, search and copy-to-clipboard. */
export function renderContent(type: ContentType, data: any): string {
  const tags = (h: string[] = []) => (h.length ? `\n\n${h.map((x) => (x.startsWith("#") ? x : `#${x}`)).join(" ")}` : "");
  switch (type) {
    case "idea":
      return `${data.title}\n\nAngle: ${data.angle}\nWhy it works: ${data.whyItWorks}\nBest for: ${data.bestFor}${data.keywords?.length ? `\nKeywords: ${data.keywords.join(", ")}` : ""}`;
    case "hook":
      return data.text;
    case "reel":
      return [
        `${data.title} (${data.durationSec}s)`,
        `HOOK (0–3s): ${data.hook}`,
        ...data.beats.map((b: any) => `[${b.start}–${b.end}s] ${b.voiceover}${b.onScreenText ? `\n  On-screen: ${b.onScreenText}` : ""}${b.visual ? `\n  Visual: ${b.visual}` : ""}`),
        `CTA: ${data.cta}`,
        `Caption: ${data.caption}${tags(data.hashtags)}`,
      ].join("\n\n");
    case "script":
      return [
        data.title,
        data.thumbnailText ? `Thumbnail: ${data.thumbnailText}${data.thumbnailVisual ? ` — ${data.thumbnailVisual}` : ""}` : "",
        ...data.sections.map((s: any) => `━━ ${s.heading}${s.timing ? ` (${s.timing})` : ""} ━━\n${s.content}${s.broll ? `\n[B-ROLL: ${s.broll}]` : ""}`),
        `CTA: ${data.cta}`,
      ].filter(Boolean).join("\n\n");
    case "caption":
      return `${data.text}${tags(data.hashtags)}`;
    case "post":
      return `${data.text}${tags(data.hashtags)}${data.imageIdea ? `\n\n[Image idea: ${data.imageIdea}]` : ""}`;
    case "carousel":
      return `${data.slides.map((s: any, i: number) => `Slide ${i + 1}: ${s.heading}\n${s.text}`).join("\n\n")}\n\nCaption: ${data.caption}${tags(data.hashtags)}`;
    case "image_prompt":
      return `${data.prompt}\n\nAspect ratio: ${data.aspectRatio}${data.style ? `\nStyle: ${data.style}` : ""}${data.negativePrompt ? `\nNegative: ${data.negativePrompt}` : ""}${data.textOverlay ? `\nText overlay: ${data.textOverlay}` : ""}`;
    case "video_prompt":
      return `${data.prompt}\n\nDuration: ${data.durationSec}s · ${data.aspectRatio}${data.camera ? `\nCamera: ${data.camera}` : ""}${data.style ? `\nStyle: ${data.style}` : ""}${data.audio ? `\nAudio: ${data.audio}` : ""}`;
  }
}

export interface ContentCheck {
  level: "warn" | "info";
  code: "LANGUAGE" | "AI_ISM" | "INCOME_CLAIM" | "GUARANTEE" | "SCARCITY" | "HOOK_LENGTH" | "HINDI_WORD" | "UNSOURCED_STAT";
  message: string;
}

const AI_ISMS = ["delve", "leverage", "comprehensive", "it's worth noting", "it is worth noting", "in conclusion", "transformative", "let's explore", "unlock the power", "game-changing", "in today's fast-paced"];
// Common Hindi words that read as non-Pakistani in Urdu content.
const HINDI_WORDS = ["dhanyavaad", "dhanyavad", "shubh", "prashn", "uttar", "vishay", "samasya", "jankari", "sahayata", "nishulk"];

function scriptRatio(text: string) {
  const urdu = (text.match(/[؀-ۿݐ-ݿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return urdu + latin === 0 ? null : urdu / (urdu + latin);
}

/** Heuristic checks. They warn; a person decides. */
export function checkContent(input: { type: ContentType; language: (typeof CONTENT_LANGUAGES)[number]; text: string; hook?: string; hasSources: boolean }): ContentCheck[] {
  const checks: ContentCheck[] = [];
  const t = input.text;
  const lower = t.toLowerCase();

  // Prompts for image/video models are written in English by design.
  if (input.type !== "image_prompt" && input.type !== "video_prompt") {
    const ratio = scriptRatio(t.replace(/#\S+/g, ""));
    if (ratio !== null) {
      if (input.language === "ur" && ratio < 0.6) checks.push({ level: "warn", code: "LANGUAGE", message: "Marked as Urdu (script) but most of the text is in Latin letters." });
      if (input.language !== "ur" && ratio > 0.2) checks.push({ level: "warn", code: "LANGUAGE", message: `Marked as ${input.language === "en" ? "English" : "Roman Urdu"} but contains a lot of Urdu script.` });
    }
  }
  const isms = AI_ISMS.filter((w) => lower.includes(w));
  if (isms.length) checks.push({ level: "warn", code: "AI_ISM", message: `Generic AI phrasing: ${isms.map((w) => `"${w}"`).join(", ")}. Rewrite in Aamir's voice.` });
  const hindi = HINDI_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(t));
  if (hindi.length) checks.push({ level: "warn", code: "HINDI_WORD", message: `Hindi words: ${hindi.join(", ")}. Use Pakistani Urdu.` });

  if (/(kama|kamaa|earn|income|kamai|salary)[^.\n]{0,40}(rs\.?|pkr|rupees|\$|lakh|lac|hazar|k\b|\d)|(rs\.?|pkr|\$)\s?\d[\d,]*\s?(k|lakh|lac)?\s?(per|a|har|\/)?\s?(month|mahine|mahina|day|din|week)/i.test(t)) {
    checks.push({ level: "warn", code: "INCOME_CLAIM", message: "Income/earnings claim. Only keep it with a real, cited source (Meta ad policy prohibits unrealistic income claims)." });
  }
  if (/\b(guarantee[d]?|100\s?%|pakka|sure[- ]shot|get rich|overnight|raaton raat)\b/i.test(t)) {
    checks.push({ level: "warn", code: "GUARANTEE", message: "Guarantee / get-rich language. Remove or soften; results can't be promised." });
  }
  if (/\b(only|sirf)\s+\d+\s+(seats?|spots?|log)\b|\blast chance\b|\bakhri mauqa\b/i.test(t)) {
    checks.push({ level: "warn", code: "SCARCITY", message: "Scarcity claim. Must match real seats left in course.catalog, otherwise remove." });
  }
  if (/\d+(\.\d+)?\s?%/.test(t) && !input.hasSources) {
    checks.push({ level: "warn", code: "UNSOURCED_STAT", message: "Contains a percentage/statistic without a source. Add a source or mark it as an estimate." });
  }
  if (input.hook && input.hook.split(/\s+/).filter(Boolean).length > 18) {
    checks.push({ level: "info", code: "HOOK_LENGTH", message: "Hook is long for the first 3 seconds (aim for ≤ 15 words)." });
  }
  return checks;
}
