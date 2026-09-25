import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "";
const password = process.env.E2E_PASSWORD ?? "";
test.skip(!email || !password, "set E2E_EMAIL and E2E_PASSWORD");

// Requires the worker running. With no ANTHROPIC_API_KEY, ACC_ENABLE_MOCKS=true must be set (dev only).
test("run a task end-to-end and see it in Agent Activity", async ({ page, isMobile }, info) => {
  test.skip(isMobile, "desktop flow is enough for the task pipeline");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);

  await page.goto("/tasks");
  await page.getByLabel("New task").fill("Find today's important AI developments and turn them into three Reel ideas.");
  await page.getByRole("button", { name: "Run task" }).click();

  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
  await expect(page.getByText("research agent", { exact: true })).toBeVisible();
  await expect(page.getByText("content agent", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Step 2 · content agent")).toBeVisible();
  await expect(page.getByText("Review · orchestrator")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Result" })).toBeVisible();
  await page.screenshot({ path: `e2e/.results/task-detail-${info.project.name}.png`, fullPage: true });

  await page.goto("/agents");
  await expect(page.getByRole("cell", { name: /kb\.search/ }).first()).toBeVisible();
  await page.screenshot({ path: `e2e/.results/agents-${info.project.name}.png`, fullPage: true });
});
