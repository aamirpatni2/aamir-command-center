import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

test("knowledge: draft is invisible to agents until approved", async ({ page }, info) => {
  const stamp = Date.now().toString(36);
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("Title").fill(`Recording policy ${stamp}`);
  await page.getByLabel("Category").selectOption("policy");
  await page.getByLabel("Content").fill(`Har class ki recording 30 din tak available rehti hai. Code ${stamp}.`);
  await page.getByRole("button", { name: "Save as draft" }).click();

  await page.getByLabel("Knowledge search").fill(stamp);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Nothing approved matches")).toBeVisible();

  const card = page.locator("section", { hasText: `Recording policy ${stamp}` });
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.getByText("Approved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator("li", { hasText: `Recording policy ${stamp}` })).toBeVisible();
  await page.screenshot({ path: `e2e/.results/knowledge-${info.project.name}.png`, fullPage: true });
});

test("research: report shows claims, and unbacked 'verified' claims are downgraded", async ({ page }, info) => {
  await page.goto("/tasks");
  await page.getByLabel("New task").fill("Research the latest news about MCP servers for a class");
  await page.getByRole("button", { name: "Run task" }).click();
  await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/research");
  await page.getByRole("link", { name: /MCP servers/ }).first().click();
  await expect(page.getByText("Auto-downgraded: no source was retrieved in this run.")).toBeVisible();
  await expect(page.getByText("Verified", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `e2e/.results/research-${info.project.name}.png`, fullPage: true });
});
