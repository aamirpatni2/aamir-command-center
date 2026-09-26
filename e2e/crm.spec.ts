import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const SECRET = process.env.E2E_WHATSAPP_APP_SECRET ?? "dev-local-secret";

// Self-contained: sends its own signed WhatsApp messages, so it runs on an empty database.
// Needs the API and worker (mock model) running.
test("leads and WhatsApp inbox", async ({ page, request }, info) => {
  const digits = Date.now().toString().slice(-7);
  const from = `92345${digits}`;
  const name = `Ayesha Siddiqui ${digits}`;
  const send = async (text: string) => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "WABA_ID", changes: [{ field: "messages", value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "923000000000", phone_number_id: "PHONE_NUMBER_ID" },
        contacts: [{ wa_id: from, profile: { name } }],
        messages: [{ from, id: `wamid.E2E_${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
      } }] }],
    });
    const res = await request.post(`${API}/api/webhooks/whatsapp`, {
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` },
      data: raw,
    });
    expect(res.status()).toBe(200);
  };
  // Fee + dates (35) then how to pay (25) → 60 = hot.
  await send("Salam! Course ki fee kitni hai aur next batch kab start hoga?");
  await send("JazzCash se payment kar dun? Seat book karni hai");

  await page.goto("/leads");
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(name) }).getByText("Hot")).toBeVisible();
  await page.screenshot({ path: `e2e/.results/leads-${info.project.name}.png`, fullPage: true });

  // Duplicate protection from the UI: same number, different format → lands on the existing lead.
  await page.getByRole("button", { name: "Add lead" }).click();
  await page.getByLabel("Phone (e.g. 0300 1234567)").fill(`0345 ${digits}`);
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Asked how to enrol / pay")).toBeVisible();
  await page.screenshot({ path: `e2e/.results/lead-detail-${info.project.name}.png`, fullPage: true });

  await page.getByRole("link", { name: "Open conversation" }).click();
  // Two quick messages → the newest draft supersedes the older one: exactly one pending draft.
  // Triage runs after WHATSAPP_TRIAGE_DELAY_SECONDS; reload until it has.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Draft · waiting for your approval")).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  await expect(page.locator("ol").getByText(/JazzCash se payment/)).toBeVisible();
  await page.screenshot({ path: `e2e/.results/conversation-${info.project.name}.png`, fullPage: true });
});
