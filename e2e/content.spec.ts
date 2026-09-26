import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

// Needs the worker running (mock model in dev, or a real API key).
test("task → Content Agent draft → review → approve → schedule → calendar", { tag: "@model" }, async ({ page }, info) => {

  await page.goto("/tasks");
  await page.getByLabel("New task").fill("Ek 45 second Reel script banao: Claude vs ChatGPT for freelancers");
  await page.getByRole("button", { name: "Run task" }).click();
  await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 30_000 });

  await page.goto("/reels");
  const card = page.getByRole("link", { name: /Claude vs ChatGPT/ }).first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByText("HOOK (0–3s)").first()).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();

  // Next month, 10th, 19:30 Pakistan time.
  const d = new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 10));
  const ym = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(next);
  await page.getByLabel("Schedule for (PKT)").fill(`${ym}-10T19:30`);
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();
  await page.screenshot({ path: `e2e/.results/content-detail-${info.project.name}.png`, fullPage: true });

  await page.goto("/calendar");
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByText(monthLabel)).toBeVisible();
  await expect(page.getByRole("link", { name: /19:30 Reel: .*Claude vs ChatGPT/ }).first()).toBeVisible();
});
