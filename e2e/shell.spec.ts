import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "";
const password = process.env.E2E_PASSWORD ?? "";

test.skip(!email || !password, "set E2E_EMAIL and E2E_PASSWORD");

test("login → dashboard → navigation → logs → logout", async ({ page, isMobile }, info) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  // Wrong credentials on a throwaway address: same generic error, without locking the real account.
  await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  await expect(page.getByText("Revenue this month")).toBeVisible();
  await expect(page.getByText("Needs your approval").first()).toBeVisible();
  await page.screenshot({ path: `e2e/.results/dashboard-${info.project.name}.png`, fullPage: true });

  const openNav = async () => {
    if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  };

  // A roadmap page shows an honest placeholder, not fake data.
  await openNav();
  await page.getByRole("link", { name: /MCP Tools/ }).first().click();
  await expect(page.getByText("Arrives in Milestone 11")).toBeVisible();

  await openNav();
  await page.getByRole("link", { name: /Logs/ }).click();
  await page.getByLabel("Filter by action").fill("auth.login");
  await expect(page.getByRole("cell", { name: "auth.login", exact: true }).first()).toBeVisible();

  // Reload keeps the session (cookie), then sign out returns to login.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
  await openNav();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
