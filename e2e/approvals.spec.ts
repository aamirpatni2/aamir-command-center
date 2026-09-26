import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

// Local dev has no WhatsApp access token, so an approved reply must be reported as "not executed",
// never shown as sent. Needs the API, worker (mock model) and WHATSAPP_APP_SECRET (default from the SessionStart hook).
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const SECRET = process.env.E2E_WHATSAPP_APP_SECRET ?? "dev-local-secret";

test("approval center: edit, approve (not configured → nothing sent), cancel", { tag: "@model" }, async ({ page, request }, info) => {
  const stamp = Date.now().toString().slice(-7);
  const name = `E2E Approval ${stamp}`;
  const from = `92311${stamp}`;
  const raw = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA_ID", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "923000000000", phone_number_id: "PHONE_NUMBER_ID" },
      contacts: [{ wa_id: from, profile: { name } }],
      messages: [{ from, id: `wamid.E2E_${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Salam, next batch kab start ho raha hai?" } }],
    } }] }],
  });
  const res = await request.post(`${API}/api/webhooks/whatsapp`, {
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` },
    data: raw,
  });
  expect(res.status()).toBe(200);

  await page.goto("/approvals");
  const card = page.getByRole("listitem").filter({ hasText: name });
  // Triage runs after WHATSAPP_TRIAGE_DELAY_SECONDS; reload until the draft shows up.
  await expect(async () => {
    await page.reload();
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  await expect(card.getByText("24h window open")).toBeVisible();
  await expect(card.getByText("next batch kab start")).toBeVisible();

  await card.getByRole("button", { name: "Edit" }).click();
  await card.getByLabel("Message text").fill("Walaikum Salam! E2E edited reply.");
  await card.getByRole("button", { name: "Approve edited & send" }).click();

  await expect(card.getByText("Approved, but not executed: nothing was sent")).toBeVisible();
  await expect(card.getByText(/WHATSAPP_ACCESS_TOKEN/).first()).toBeVisible();
  await expect(card.getByText(/Edited by a person/)).toBeVisible();
  await page.screenshot({ path: `e2e/.results/approvals-${info.project.name}.png`, fullPage: true });

  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card).toBeHidden();
  await page.getByRole("tab", { name: "History" }).click();
  const done = page.getByRole("listitem").filter({ hasText: name });
  await expect(done.getByText("Rejected").first()).toBeVisible();
  await page.screenshot({ path: `e2e/.results/approvals-history-${info.project.name}.png`, fullPage: true });
});
