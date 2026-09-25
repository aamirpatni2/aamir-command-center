import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

// Expects seeded conversations (pnpm whatsapp:simulate) and the worker running.
test("leads and WhatsApp inbox", async ({ page }, info) => {

  await page.goto("/leads");
  await expect(page.getByRole("link", { name: /Ayesha Siddiqui/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Ayesha Siddiqui/ }).getByText("Hot")).toBeVisible();
  await page.screenshot({ path: `e2e/.results/leads-${info.project.name}.png`, fullPage: true });

  // Duplicate protection from the UI: same number, different format → lands on the existing lead.
  await page.getByRole("button", { name: "Add lead" }).click();
  await page.getByLabel("Phone (e.g. 0300 1234567)").fill("0345 1234567");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { name: "Ayesha Siddiqui" })).toBeVisible();
  await expect(page.getByText("Asked how to enrol / pay")).toBeVisible();
  await page.screenshot({ path: `e2e/.results/lead-detail-${info.project.name}.png`, fullPage: true });

  await page.getByRole("link", { name: "Open conversation" }).click();
  // Two quick messages → the newest draft supersedes the older one: exactly one pending draft.
  await expect(page.getByText("Draft · waiting for your approval")).toHaveCount(1);
  await expect(page.getByText(/JazzCash se payment/)).toBeVisible();
  await page.screenshot({ path: `e2e/.results/conversation-${info.project.name}.png`, fullPage: true });
});
