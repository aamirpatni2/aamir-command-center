import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildWhatsappStatusPayload, buildWhatsappTextPayload, signWhatsappBody } from "@acc/agents";
import { count, eq, schema } from "@acc/database";
import { setupTestApp, teardown, type TestContext } from "./test/helpers.js";

const SECRET = "test-app-secret";
let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp(undefined, { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: "verify-me", WHATSAPP_TRIAGE_DELAY_SECONDS: "30" });
});
afterAll(async () => ctx && teardown(ctx));

const post = (body: unknown, opts: { secret?: string; raw?: string } = {}) => {
  const raw = opts.raw ?? JSON.stringify(body);
  return ctx.app.inject({
    method: "POST",
    url: "/api/webhooks/whatsapp",
    headers: { "content-type": "application/json", "x-hub-signature-256": signWhatsappBody(raw, opts.secret ?? SECRET) },
    payload: raw,
  });
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const n = async (table: any) => (await ctx.handle.db.select({ n: count() }).from(table))[0]!.n;

describe("WhatsApp webhook", () => {
  it("verification handshake echoes the challenge only with the right token", async () => {
    const ok = await ctx.app.inject({ method: "GET", url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345" });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("12345");
    const bad = await ctx.app.inject({ method: "GET", url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345" });
    expect(bad.statusCode).toBe(403);
  });

  it("rejects a bad or missing signature", async () => {
    const body = buildWhatsappTextPayload({ from: "923001112233", id: "wamid.bad", text: "hi" });
    expect((await post(body, { secret: "wrong" })).statusCode).toBe(401);
    const noSig = await ctx.app.inject({ method: "POST", url: "/api/webhooks/whatsapp", headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    expect(noSig.statusCode).toBe(401);
    expect(await n(schema.messages)).toBe(0);
  });

  it("a signed message creates contact, conversation, message, scored lead, and queues triage", async () => {
    const body = buildWhatsappTextPayload({ from: "923001112233", name: "Ali Khan", id: "wamid.1", text: "Salam! Course ki fee kitni hai aur next batch kab start hoga?" });
    const res = await post(body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", messages: 1, newLeads: 1, triaged: 1 });

    const [contact] = await ctx.handle.db.select().from(schema.contacts).where(eq(schema.contacts.phone, "+923001112233"));
    expect(contact).toMatchObject({ name: "Ali Khan", whatsappId: "923001112233" });
    const [lead] = await ctx.handle.db.select().from(schema.leads).where(eq(schema.leads.contactId, contact!.id));
    expect(lead).toMatchObject({ source: "whatsapp", status: "new", inboundMessageCount: 1, score: 35 });
    expect(lead!.signals).toEqual({ askedFee: true, askedSchedule: true });
    expect(lead!.scoreReasons.map((r) => r.rule)).toEqual(["Asked about the fee", "Asked about dates or timings"]);
    expect(ctx.queue.triage).toEqual([{ conversationId: expect.any(String), delayMs: 30_000 }]);
    // Automation events: one per stored message, plus lead.created for a new lead.
    const [msg] = await ctx.handle.db.select().from(schema.messages);
    expect(ctx.automations.events).toEqual([
      { event: "whatsapp.message_received", ref: { messageId: msg!.id, leadNew: true }, refId: msg!.id },
      { event: "lead.created", ref: { leadId: lead!.id }, refId: lead!.id },
    ]);
  });

  it("webhook replay (identical signed body) is acknowledged but not processed again", async () => {
    const body = buildWhatsappTextPayload({ from: "923001112233", name: "Ali Khan", id: "wamid.1", text: "Salam! Course ki fee kitni hai aur next batch kab start hoga?" });
    const res = await post(body);
    expect(res.json()).toEqual({ status: "duplicate" });
    expect(await n(schema.messages)).toBe(1);
    expect(ctx.queue.triage).toHaveLength(1);
    expect(ctx.automations.events).toHaveLength(2);
  });

  it("duplicate message id in a different delivery is not stored twice", async () => {
    const body = buildWhatsappTextPayload({ from: "923001112233", name: "Ali Khan", id: "wamid.1", text: "Salam! Course ki fee kitni hai aur next batch kab start hoga?", timestamp: 1 });
    const res = await post(body);
    expect(res.json()).toMatchObject({ status: "ok", messages: 0, duplicates: 1 });
    expect(await n(schema.messages)).toBe(1);
    const [lead] = await ctx.handle.db.select().from(schema.leads);
    expect(lead!.inboundMessageCount).toBe(1);
  });

  it("more messages from the same person update the same lead (no duplicate lead)", async () => {
    await post(buildWhatsappTextPayload({ from: "923001112233", id: "wamid.2", text: "JazzCash se payment ho sakti hai? Enroll karna hai" }));
    await post(buildWhatsappTextPayload({ from: "923001112233", id: "wamid.3", text: "Please batayein" }));
    expect(await n(schema.leads)).toBe(1);
    const [lead] = await ctx.handle.db.select().from(schema.leads);
    // fee 20 + schedule 15 + enrol 25 + engaged (3 msgs) 10 = 70 → hot
    expect(lead).toMatchObject({ inboundMessageCount: 3, score: 70 });
  });

  it("delivery statuses only move forward", async () => {
    const [conv] = await ctx.handle.db.select().from(schema.conversations);
    await ctx.handle.db.insert(schema.messages).values({ conversationId: conv!.id, direction: "outbound", providerMessageId: "wamid.out1", body: "Walaikum salam", status: "sent", sentBy: "user" });
    await post(buildWhatsappStatusPayload({ id: "wamid.out1", status: "read" }));
    await post({ ...buildWhatsappStatusPayload({ id: "wamid.out1", status: "delivered" }), entry: [{ ...buildWhatsappStatusPayload({ id: "wamid.out1", status: "delivered" }).entry[0]!, id: "other" }] });
    const [m] = await ctx.handle.db.select().from(schema.messages).where(eq(schema.messages.providerMessageId, "wamid.out1"));
    expect(m!.status).toBe("read");
  });

  it("unknown payload shapes are acknowledged (no Meta retry storm) and invalid JSON is 400", async () => {
    expect((await post({ object: "page", entry: [] })).json()).toEqual({ status: "ignored" });
    expect((await post(null, { raw: "{not json" })).statusCode).toBe(400);
  });

  it("returns 503 when the app secret is not configured", async () => {
    const other = await setupTestApp(undefined, {});
    try {
      const raw = JSON.stringify(buildWhatsappTextPayload({ from: "923001112233", id: "x", text: "hi" }));
      const res = await other.app.inject({ method: "POST", url: "/api/webhooks/whatsapp", headers: { "content-type": "application/json", "x-hub-signature-256": signWhatsappBody(raw, SECRET) }, payload: raw });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("NOT_CONFIGURED");
    } finally {
      await teardown(other);
    }
  });
});
