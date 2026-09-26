export const TYPE_LABEL: Record<string, string> = {
  idea: "Idea", hook: "Hook", reel: "Reel", script: "YouTube script", caption: "Caption", post: "Post",
  carousel: "Carousel", image_prompt: "Image prompt", video_prompt: "Video prompt",
};
export const LANG_LABEL: Record<string, string> = { ur: "Urdu", "ur-roman": "Roman Urdu", en: "English" };

export interface ContentRow {
  id: string;
  type: string;
  platform: string | null;
  language: string;
  title: string | null;
  status: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string;
  sourceTaskId: string | null;
  preview: string;
  checkCount: number;
}

export interface ContentCheck { level: "warn" | "info"; code: string; message: string }

export interface ContentItem extends Omit<ContentRow, "preview" | "checkCount"> {
  body: string;
  sources: { url: string; title?: string }[];
  data: {
    format: Record<string, any>;
    checks: ContentCheck[];
    createdBy?: string;
    edited?: boolean;
    publishedUrl?: string;
    history?: { from: string; to: string; at: string; note: string | null }[];
  };
}
