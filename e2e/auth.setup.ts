import { expect, test as setup } from "@playwright/test";

export const STATE = "e2e/.auth/owner.json";

/** Logs in once per run and saves the session so specs don't hit the login rate limit. */
setup("sign in", async ({ page }) => {
  setup.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, "set E2E_EMAIL and E2E_PASSWORD");
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  await page.context().storageState({ path: STATE });
});
