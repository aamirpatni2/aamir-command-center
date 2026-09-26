import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

// The owner adds a team member; that person sees only what their role allows, can't decide
// approvals, can change their own password, and the old password stops working.
test("an operator gets a restricted, read-only-where-it-matters view", async ({ page, browser }) => {
  const stamp = Date.now().toString(36);
  const email = `operator-${stamp}@example.test`;
  const first = `first-${stamp}-long-enough`;
  const second = `second-${stamp}-long-enough`;

  const me = await (await page.request.get("/api/auth/me")).json();
  const created = await page.request.post("/api/users", {
    headers: { "x-csrf-token": me.csrfToken },
    data: { email, name: "E2E Operator", role: "operator", password: first },
  });
  expect(created.status()).toBe(201);

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const op = await ctx.newPage();
  const signIn = async (password: string) => {
    await op.goto("/login");
    await op.getByLabel("Email").fill(email);
    await op.getByLabel("Password").fill(password);
    await op.getByRole("button", { name: "Sign in" }).click();
  };
  await signIn(first);
  await expect(op.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);

  const nav = op.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Approvals" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Leads" })).toBeVisible();
  // Owner/admin only.
  await expect(nav.getByRole("link", { name: "Integrations" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Logs" })).toHaveCount(0);

  await op.goto("/approvals");
  await expect(op.getByText("Read-only: only the owner or an admin can approve")).toBeVisible();
  await expect(op.getByRole("button", { name: "Approve" })).toHaveCount(0);

  // The API refuses too, not just the UI.
  const opMe = await (await op.request.get("/api/auth/me")).json();
  expect((await op.request.get("/api/users")).status()).toBe(403);
  expect((await op.request.post("/api/users", { headers: { "x-csrf-token": opMe.csrfToken }, data: { email: `x-${email}`, name: "x", role: "owner", password: first } })).status()).toBe(403);

  await op.goto("/settings");
  await op.getByLabel("Current password").fill(first);
  await op.getByLabel("New password (12+ characters)").fill(second);
  await op.getByLabel("Repeat new password").fill(second);
  await op.getByRole("button", { name: "Change password" }).click();
  await expect(op.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();

  await op.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(first);
  await expect(op.getByRole("alert")).toBeVisible();
  await signIn(second);
  await expect(op.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  await ctx.close();

  // Tidy up: deactivate the throwaway account.
  const deactivate = await page.request.patch(`/api/users/${(await created.json()).user.id}`, { headers: { "x-csrf-token": me.csrfToken }, data: { isActive: false } });
  expect(deactivate.status()).toBe(200);
});
