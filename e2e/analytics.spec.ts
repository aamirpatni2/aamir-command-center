import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

test("today, analytics, insights, reports and ads", async ({ page }, info) => {
  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/needs you/i);
  await expect(page.getByText("Waiting for a reply").first()).toBeVisible();
  await page.screenshot({ path: `e2e/.results/today-${info.project.name}.png`, fullPage: true });

  await page.goto("/analytics?range=last_30_days");
  await expect(page.getByText("Verified revenue").first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "30 days" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Agent performance")).toBeVisible();
  await page.getByRole("tab", { name: "7 days" }).click();
  await expect(page).toHaveURL(/range=last_7_days/);
  await page.screenshot({ path: `e2e/.results/analytics-${info.project.name}.png`, fullPage: true });

  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "AI Insights", level: 1 })).toBeVisible();

  // A numbers-only snapshot opens its report page.
  await page.goto("/reports");
  await page.getByRole("button", { name: "Last week" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Weekly report · /);
  await expect(page.getByText("This is a numbers-only snapshot.")).toBeVisible();
  await page.screenshot({ path: `e2e/.results/report-${info.project.name}.png`, fullPage: true });

  await page.goto("/ads");
  await expect(page.getByText("Meta Ads isn't connected")).toBeVisible();
});
