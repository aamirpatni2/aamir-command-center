import { expect, test, type Browser } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

async function signIn(browser: Browser, email: string, password: string) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  return { ctx, page };
}

// The owner manages the team from the Team page: add → the person signs in with the temporary
// password → reset password → change role → deactivate (can't sign in) → reactivate.
test("team page: add a member, reset their password, change role, deactivate", async ({ page, browser }, info) => {
  page.on("dialog", (d) => void d.accept());
  const stamp = Date.now().toString(36);
  const name = `E2E Member ${stamp}`;
  const email = `member-${stamp}@example.test`;

  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
  await expect(page.getByText("What each role can do")).toBeVisible();

  // Add, and read the one-time temporary password.
  const add = page.locator("section").filter({ hasText: "Add a team member" });
  await add.getByLabel("Name").fill(name);
  await add.getByLabel("Email", { exact: true }).fill(email);
  await add.getByLabel("Role").selectOption("operator");
  await add.getByLabel(/Temporary password/).first().check();
  await add.getByRole("button", { name: "Add member" }).click();
  const temp = (await add.getByTestId("temp-password").textContent())!;
  expect(temp).toMatch(/^[\w]{6}-[\w]{6}-[\w]{6}$/);
  await add.getByRole("button", { name: "Done" }).click();

  const row = page.getByRole("listitem", { name });
  await expect(row).toContainText(email);
  await expect(row).toContainText("Never signed in");
  await page.screenshot({ path: `e2e/.results/team-${info.project.name}.png`, fullPage: true });

  // They sign in with it; as an operator they don't see the Team page.
  let member = await signIn(browser, email, temp);
  await expect(member.page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  await expect(member.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Team" })).toHaveCount(0);

  // Reset: a new temporary password; their session ends; the old one stops working.
  await row.getByRole("button", { name: "Temporary password" }).click();
  const fresh = (await row.getByTestId("temp-password").textContent())!;
  expect(fresh).not.toBe(temp);
  await member.page.reload();
  await expect(member.page).toHaveURL(/\/login/);
  await member.ctx.close();
  member = await signIn(browser, email, temp);
  await expect(member.page.getByRole("alert")).toBeVisible();
  await member.ctx.close();

  // Role change, then deactivate: they can't sign in even with the right password.
  await row.getByLabel(`Role for ${name}`).selectOption("viewer");
  await expect(row.getByLabel(`Role for ${name}`)).toHaveValue("viewer");
  await row.getByRole("button", { name: "Deactivate" }).click();
  // Deactivated people move to their own collapsed section.
  await expect(page.getByRole("list", { name: "Active members" }).getByRole("listitem", { name })).toHaveCount(0);
  await page.getByRole("button", { name: /^Deactivated \(\d+\)$/ }).click();
  await expect(row).toContainText("Deactivated");
  member = await signIn(browser, email, fresh);
  await expect(member.page.getByRole("alert")).toBeVisible();
  await member.ctx.close();

  // Reactivate: signing in works again.
  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByRole("list", { name: "Active members" }).getByRole("listitem", { name })).toContainText("Active");
  member = await signIn(browser, email, fresh);
  await expect(member.page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  await member.ctx.close();

  // Your own row can't be demoted or deactivated from here.
  const me = page.getByRole("list", { name: "Active members" }).getByRole("listitem").filter({ has: page.getByText("You", { exact: true }) });
  await expect(me).toHaveCount(1);
  await expect(me.getByRole("button", { name: "Deactivate" })).toHaveCount(0);

  // Edit name and email: a duplicate is refused; after saving they sign in with the new email.
  const newName = `${name} Renamed`;
  const newEmail = `renamed-${stamp}@example.test`;
  await row.getByRole("button", { name: "Edit" }).click();
  const form = row.getByRole("form", { name: `Edit ${name}` });
  await form.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toContainText("already uses this email");
  await form.getByLabel("Name").fill(newName);
  await form.getByLabel("Email").fill(newEmail);
  await form.getByRole("button", { name: "Save" }).click();
  const renamed = page.getByRole("listitem", { name: newName });
  await expect(renamed).toContainText(newEmail);
  member = await signIn(browser, email, fresh);
  await expect(member.page.getByRole("alert")).toBeVisible();
  await member.ctx.close();
  member = await signIn(browser, newEmail, fresh);
  await expect(member.page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  await member.ctx.close();

  // Editing your own name updates the sidebar at once (then change it back).
  const ownName = (await me.getAttribute("aria-label"))!;
  let mine = page.getByRole("listitem", { name: ownName, exact: true });
  await mine.getByRole("button", { name: "Edit" }).click();
  await mine.getByRole("form").getByLabel("Name").fill(`${ownName} Test`);
  await mine.getByRole("form").getByRole("button", { name: "Save" }).click();
  // The sidebar's account box (not the Team list) shows the new name without a reload.
  await expect(page.getByRole("complementary").getByText(`${ownName} Test`, { exact: true })).toBeVisible();
  mine = page.getByRole("listitem", { name: `${ownName} Test`, exact: true });
  await mine.getByRole("button", { name: "Edit" }).click();
  await mine.getByRole("form").getByLabel("Name").fill(ownName);
  await mine.getByRole("form").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("complementary").getByText(ownName, { exact: true })).toBeVisible();

  // Tidy up.
  await renamed.getByRole("button", { name: "Deactivate" }).click();
  await expect(renamed).toContainText("Deactivated");
});
