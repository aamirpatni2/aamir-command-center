import { describe, expect, it } from "vitest";
import { signWhatsappBody, verifyWhatsappSignature, WhatsAppClient } from "./client.js";
import { parseWhatsappWebhook, buildWhatsappTextPayload } from "./payload.js";

describe("WhatsAppClient (contract)", () => {
  it("reports not_configured without credentials", async () => {
    expect(await new WhatsAppClient({ graphVersion: "v21.0" }).sendText("+923001234567", "hi")).toEqual({
      status: "not_configured", missing: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
    });
  });
  it("sends the documented Cloud API request", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ messages: [{ id: "wamid.OUT" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await new WhatsAppClient({ accessToken: "tok", phoneNumberId: "123", graphVersion: "v21.0" }, fetchImpl).sendText("+923001234567", "Salam");
    expect(r).toEqual({ status: "sent", providerMessageId: "wamid.OUT" });
    expect(captured!.url).toBe("https://graph.facebook.com/v21.0/123/messages");
    expect(new Headers(captured!.init.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(String(captured!.init.body))).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "923001234567", type: "text", text: { preview_url: false, body: "Salam" } });
  });
  it("maps API errors", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), { status: 400 })) as unknown as typeof fetch;
    expect(await new WhatsAppClient({ accessToken: "t", phoneNumberId: "1", graphVersion: "v21.0" }, fetchImpl).sendText("+92300", "x")).toMatchObject({ status: "error", code: 131047 });
  });
});

describe("signature + parsing", () => {
  it("verifies HMAC signatures over the exact bytes", () => {
    const raw = Buffer.from('{"a":1}');
    expect(verifyWhatsappSignature(raw, signWhatsappBody(raw, "k"), "k")).toBe(true);
    expect(verifyWhatsappSignature(Buffer.from('{"a":2}'), signWhatsappBody(raw, "k"), "k")).toBe(false);
    expect(verifyWhatsappSignature(raw, "sha256=deadbeef", "k")).toBe(false);
    expect(verifyWhatsappSignature(raw, undefined, "k")).toBe(false);
  });
  it("parses text messages with profile names", () => {
    const p = parseWhatsappWebhook(buildWhatsappTextPayload({ from: "923001234567", name: "Ali", id: "wamid.1", text: "Salam", timestamp: 1_700_000_000 }));
    expect(p!.messages[0]).toMatchObject({ from: "923001234567", profileName: "Ali", text: "Salam", providerMessageId: "wamid.1" });
    expect(p!.messages[0]!.sentAt.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(parseWhatsappWebhook({ object: "page" })).toBeNull();
  });
});
