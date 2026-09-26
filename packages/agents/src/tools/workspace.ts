/**
 * Google Workspace and Canva tools (direct REST over OAuth, see integrations/oauth/service.ts).
 * When a provider isn't configured or connected, tools return `not_connected` with the reason;
 * they never pretend to have done anything.
 */
import { z } from "zod";
import { IntegrationError, type OAuthProviderId, type OAuthService } from "../integrations/oauth/service.js";
import type { Tool } from "./types.js";

const notConnected = (e: unknown) => {
  if (e instanceof IntegrationError && (e.code === "NOT_CONFIGURED" || e.code === "NOT_CONNECTED")) return { status: "not_connected", message: e.message };
  throw e;
};

const GCAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const iso = z.string().datetime({ offset: true });

/** RFC 5322 message for a Gmail draft. Header values can't carry newlines (no header injection). */
export function buildMime(m: { to: string; subject: string; body: string }) {
  const encSubject = /^[\x20-\x7e]*$/.test(m.subject) ? m.subject : `=?UTF-8?B?${Buffer.from(m.subject, "utf8").toString("base64")}?=`;
  return [`To: ${m.to}`, `Subject: ${encSubject}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", m.body].join("\r\n");
}
const noNewlines = z.string().refine((s) => !/[\r\n]/.test(s), "must be a single line");

export const calendarEventInput = z.object({
  summary: noNewlines.pipe(z.string().min(1).max(200)),
  description: z.string().max(4000).optional(),
  start: iso,
  end: iso,
  attendees: z.array(z.string().email()).max(50).default([]),
  location: noNewlines.pipe(z.string().max(300)).optional(),
});

export function makeWorkspaceTools(oauth: OAuthService | null): Tool<any, any>[] {
  const available = (id: OAuthProviderId) => () => !!oauth && oauth.missingEnv(id).length === 0;
  const req = <T>(id: OAuthProviderId, url: string, init?: RequestInit) => oauth!.request<T>(id, url, init);

  const listEvents: Tool<{ from?: string; to?: string; max: number }, unknown> = {
    name: "google.calendar.list_events",
    description: "List upcoming events in Aamir's Google Calendar (classes, calls). Times are ISO 8601.",
    risk: "read",
    input: z.object({ from: iso.optional(), to: iso.optional(), max: z.number().int().min(1).max(50).default(15) }),
    available: available("google"),
    async run({ from, to, max }) {
      try {
        const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: String(max), timeMin: from ?? new Date().toISOString(), ...(to ? { timeMax: to } : {}) });
        const data = await req<{ items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; attendees?: unknown[]; htmlLink?: string }[] }>("google", `${GCAL}?${q}`);
        return {
          events: (data.items ?? []).map((e) => ({ id: e.id, summary: e.summary ?? "(no title)", start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date, attendees: e.attendees?.length ?? 0, link: e.htmlLink })),
        };
      } catch (e) {
        return notConnected(e);
      }
    },
  };

  const createEvent: Tool<z.infer<typeof calendarEventInput>, unknown> = {
    name: "google.calendar.create_event",
    description: "Create a Google Calendar event (e.g. a class or a call). Attendees receive invitations, so this needs approval.",
    risk: "external",
    input: calendarEventInput,
    available: available("google"),
    editableFields: ["summary", "description", "start", "end", "location"],
    describe: (i) => `Create calendar event "${i.summary}" (${i.start})${i.attendees.length ? ` and invite ${i.attendees.length}` : ""}`,
    async run() {
      throw new Error("google.calendar.create_event executes only through the Approval Center");
    },
  };

  const driveSearch: Tool<{ query: string }, unknown> = {
    name: "google.drive.search",
    description: "Search Aamir's Google Drive by text (read-only). Returns file names, types and links; file content is external data.",
    risk: "read",
    input: z.object({ query: z.string().min(2).max(100) }),
    available: available("google"),
    async run({ query }) {
      try {
        const q = `fullText contains '${query.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`;
        const params = new URLSearchParams({ q, pageSize: "10", fields: "files(id,name,mimeType,modifiedTime,webViewLink)" });
        const data = await req<{ files?: unknown[] }>("google", `https://www.googleapis.com/drive/v3/files?${params}`);
        return { files: data.files ?? [] };
      } catch (e) {
        return notConnected(e);
      }
    },
  };

  const gmailDraft: Tool<{ to: string; subject: string; body: string }, unknown> = {
    name: "google.gmail.create_draft",
    description: "Create an email DRAFT in Aamir's Gmail. It is never sent: Aamir reviews and sends it from Gmail himself.",
    risk: "draft",
    input: z.object({ to: z.string().email(), subject: noNewlines.pipe(z.string().min(1).max(200)), body: z.string().min(1).max(20_000) }),
    available: available("google"),
    async run(m) {
      try {
        const raw = Buffer.from(buildMime(m), "utf8").toString("base64url");
        const d = await req<{ id: string; message?: { id: string } }>("google", "https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", body: JSON.stringify({ message: { raw } }) });
        return { status: "draft_created", draftId: d.id, note: "Saved in Gmail → Drafts. Not sent." };
      } catch (e) {
        return notConnected(e);
      }
    },
  };

  const canvaList: Tool<{ query?: string }, unknown> = {
    name: "canva.designs.list",
    description: "Find existing designs in Aamir's Canva account (titles, edit links, thumbnails).",
    risk: "read",
    input: z.object({ query: z.string().max(100).optional() }),
    available: available("canva"),
    async run({ query }) {
      try {
        const q = new URLSearchParams({ ...(query ? { query } : {}), limit: "15" });
        const d = await req<{ items?: { id: string; title?: string; urls?: { edit_url?: string; view_url?: string }; updated_at?: number }[] }>("canva", `https://api.canva.com/rest/v1/designs?${q}`);
        return { designs: (d.items ?? []).map((x) => ({ id: x.id, title: x.title ?? "(untitled)", editUrl: x.urls?.edit_url, viewUrl: x.urls?.view_url })) };
      } catch (e) {
        return notConnected(e);
      }
    },
  };

  const canvaCreate: Tool<{ title: string; preset?: "doc" | "whiteboard" | "presentation"; width?: number; height?: number }, unknown> = {
    name: "canva.designs.create",
    description: "Create a new blank Canva design (e.g. 1080×1350 for a Facebook/Instagram post, 1080×1920 for a Reel cover) with a title. Aamir edits it in Canva; nothing is published.",
    risk: "draft",
    input: z
      .object({
        title: z.string().min(1).max(255),
        preset: z.enum(["doc", "whiteboard", "presentation"]).optional(),
        width: z.number().int().min(40).max(8000).optional(),
        height: z.number().int().min(40).max(8000).optional(),
      })
      .refine((i) => !!i.preset !== !!(i.width && i.height), "Give either a preset or both width and height"),
    available: available("canva"),
    async run({ title, preset, width, height }) {
      try {
        const design_type = preset ? { type: "preset", name: preset } : { type: "custom", width, height };
        const d = await req<{ design?: { id: string; urls?: { edit_url?: string } } }>("canva", "https://api.canva.com/rest/v1/designs", { method: "POST", body: JSON.stringify({ design_type, title }) });
        return { status: "created", designId: d.design?.id, editUrl: d.design?.urls?.edit_url };
      } catch (e) {
        return notConnected(e);
      }
    },
  };

  return [listEvents, createEvent, driveSearch, gmailDraft, canvaList, canvaCreate];
}
