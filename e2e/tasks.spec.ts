import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

// Requires the worker running. With no ANTHROPIC_API_KEY, ACC_ENABLE_MOCKS=true must be set (dev only).
test("run a task end-to-end and see it in Agent Activity", async ({ page }, info) => {

  await page.goto("/tasks");
  await page.getByLabel("New task").fill("Find today's important AI developments and turn them into three Reel ideas.");
  await page.getByRole("button", { name: "Run task" }).click();

  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
  await expect(page.getByText("Research agent", { exact: true })).toBeVisible();
  await expect(page.getByText("Content agent", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Step 2 · content agent")).toBeVisible();
  await expect(page.getByText("Review · orchestrator")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Result" })).toBeVisible();
  await page.screenshot({ path: `e2e/.results/task-detail-${info.project.name}.png`, fullPage: true });

  await page.goto("/agents");
  await expect(page.getByRole("cell", { name: /kb\.search/ }).first()).toBeVisible();
  await page.screenshot({ path: `e2e/.results/agents-${info.project.name}.png`, fullPage: true });
});
