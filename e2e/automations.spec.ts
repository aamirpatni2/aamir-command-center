import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

// Needs the API, the worker (automations queue) and WHATSAPP_APP_SECRET (default from the SessionStart hook).
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const SECRET = process.env.E2E_WHATSAPP_APP_SECRET ?? "dev-local-secret";

test("automation: template → dry run → switch on → real WhatsApp event → run logged", async ({ page, request }, info) => {
  const stamp = Date.now().toString().slice(-7);
  const ruleName = `E2E hot flag ${stamp}`;

  await page.goto("/automations");
  await page.getByRole("button", { name: /Flag hot WhatsApp leads for a call/ }).click();
  await page.getByLabel("Name", { exact: true }).fill(ruleName);
  await page.getByRole("button", { name: "Dry run" }).click();
  await expect(page.getByText(/Dry run · /)).toBeVisible();
  await expect(page.getByText("Nothing was saved, sent or queued.")).toBeVisible();
  await page.getByRole("switch", { name: "Switched on" }).click();
  await page.screenshot({ path: `e2e/.results/automation-editor-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Create automation" }).click();

  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: ruleName }) });
  await expect(card).toBeVisible();
  await expect(card.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect(card.getByText("IF", { exact: true })).toBeVisible();

  // A hot enquiry (fee + dates + wants to enrol = 60 points) arrives through the signed webhook.
  const from = `92312${stamp}`;
  const raw = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA_ID", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "923000000000", phone_number_id: "PHONE_NUMBER_ID" },
      contacts: [{ wa_id: from, profile: { name: `E2E Hot ${stamp}` } }],
      messages: [{ from, id: `wamid.E2E_${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Fee kitni hai aur next batch kab start hoga? Enroll karna hai" } }],
    } }] }],
  });
  const res = await request.post(`${API}/api/webhooks/whatsapp`, {
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` },
    data: raw,
  });
  expect(res.status()).toBe(200);

  const run = page.getByRole("row").filter({ hasText: ruleName });
  await expect(async () => {
    await page.reload();
    await expect(run.first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(run.first().getByText("Completed")).toBeVisible();
  await expect(run.first().getByText(/Lead updated: note added, follow-up in 2 h/)).toBeVisible();
  await expect(run.first().getByText(`E2E Hot ${stamp}`)).toBeVisible();
  await page.screenshot({ path: `e2e/.results/automations-${info.project.name}.png`, fullPage: true });

  // Clean up so the rule doesn't affect other runs.
  const again = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: ruleName }) });
  await again.getByRole("button", { name: `Delete ${ruleName}` }).click();
  await again.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: ruleName })).toBeHidden();
});
