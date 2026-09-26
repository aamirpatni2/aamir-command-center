import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

// Where the test reads the emails the app sent:
// - E2E_MAILPIT_URL set: a Mailpit test SMTP server (the production stack in CI sends real SMTP to it);
// - otherwise the development outbox (data/outbox), written in mock mail mode.
const MAILPIT = process.env.E2E_MAILPIT_URL;
const OUTBOX = join(process.cwd(), "data", "outbox");

async function latestMailTo(to: string): Promise<{ subject: string; text: string }> {
  if (MAILPIT) {
    for (let i = 0; i < 20; i++) {
      const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages: { ID: string; Subject: string }[] };
      if (list.messages.length) {
        const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0]!.ID}`)).json()) as { Subject: string; Text: string };
        return { subject: msg.Subject, text: msg.Text };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`no mail to ${to} in Mailpit`);
  }
  const files = readdirSync(OUTBOX).filter((f) => f.endsWith(".json")).sort();
  for (const f of files.reverse()) {
    const mail = JSON.parse(readFileSync(join(OUTBOX, f), "utf8")) as { to: string; subject: string; text: string; mock: boolean };
    if (mail.to === to) return mail;
  }
  throw new Error(`no mail to ${to}`);
}
/** Mailpit keeps every message; count them so a resend can be told apart from the first send. */
async function mailCount(to: string) {
  if (!MAILPIT) return readdirSync(OUTBOX).filter((f) => f.endsWith(".json")).length;
  const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages_count: number };
  return list.messages_count;
}
const linkIn = (text: string) => /(https?:\/\/\S+\/invite#[A-Za-z0-9_-]{43})/.exec(text)![1]!;

async function openInFreshBrowser(browser: Browser, url: string) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  // The link points at PUBLIC_URL; open the same path on the server under test.
  await page.goto(new URL(url).pathname + new URL(url).hash);
  return { ctx, page };
}

test("email invite: add → link → choose password → sign in; reset link; used links stop working", { tag: "@mail" }, async ({ page, browser }) => {
  page.on("dialog", (d) => void d.accept());
  const stamp = Date.now().toString(36);
  const name = `Invitee ${stamp}`;
  const email = `invitee-${stamp}@example.test`;

  await page.goto("/team");
  const add = page.locator("section").filter({ hasText: "Add a team member" });
  if (!MAILPIT) await expect(add.getByText("emails are saved to data/outbox")).toBeVisible();
  await add.getByLabel("Name").fill(name);
  await add.getByLabel("Email", { exact: true }).fill(email);
  await add.getByLabel("Role").selectOption("viewer");
  await expect(add.getByLabel(/Email an invite/)).toBeChecked();
  await add.getByRole("button", { name: "Add and send invite" }).click();
  await expect(add.getByRole("status")).toContainText(MAILPIT ? `Invite emailed to ${email}` : `the invite email for ${email} was saved`);
  await add.getByRole("button", { name: "Done" }).click();

  const row = page.getByRole("list", { name: "Active members" }).getByRole("listitem", { name });
  await expect(row).toContainText("Invited");

  // The email: subject, and a link whose token is in the fragment.
  const mail = await latestMailTo(email);
  expect(mail.subject).toContain("invited");
  const link = linkIn(mail.text);

  // Resend: the first link stops working.
  const before = await mailCount(email);
  await row.getByRole("button", { name: "Resend invite" }).click();
  await expect(row.getByRole("status")).toContainText(MAILPIT ? "emailed" : "saved to");
  await expect.poll(() => mailCount(email)).toBeGreaterThan(before);
  const link2 = linkIn((await latestMailTo(email)).text);
  expect(link2).not.toBe(link);
  let tab = await openInFreshBrowser(browser, link);
  await expect(tab.page.getByRole("alert")).toContainText("doesn't work any more");
  await tab.ctx.close();

  // Accept: the token leaves the address bar at once; weak password refused; then set.
  tab = await openInFreshBrowser(browser, link2);
  await expect(tab.page.getByRole("heading", { name: `Welcome, ${name}` })).toBeVisible();
  expect(tab.page.url()).not.toContain("#");
  await expect(tab.page.getByLabel("Email")).toHaveValue(email);
  await tab.page.getByLabel("New password (12+ characters)").fill("password1234");
  await tab.page.getByLabel("Repeat password").fill("password1234");
  await tab.page.getByRole("button", { name: "Set password" }).click();
  await expect(tab.page.getByRole("alert")).toContainText("too common");
  const chosen = `chosen-${stamp}-passphrase`;
  await tab.page.getByLabel("New password (12+ characters)").fill(chosen);
  await tab.page.getByLabel("Repeat password").fill(chosen);
  await tab.page.getByRole("button", { name: "Set password" }).click();
  await expect(tab.page.getByRole("status")).toContainText("Your password is set");
  await expect(tab.page.getByLabel("Email")).toHaveValue(email);
  await tab.page.getByLabel("Password").fill(chosen);
  await tab.page.getByRole("button", { name: "Sign in" }).click();
  await expect(tab.page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);

  // Used link can't be reused.
  const again = await openInFreshBrowser(browser, link2);
  await expect(again.page.getByRole("alert")).toContainText("doesn't work any more");
  await again.ctx.close();

  // Reset link: they're signed out everywhere after using it; the old password stops working.
  await page.reload();
  const beforeReset = await mailCount(email);
  await row.getByRole("button", { name: "Email reset link" }).click();
  await expect(row.getByRole("status")).toContainText(MAILPIT ? "emailed" : "saved to");
  await expect.poll(() => mailCount(email)).toBeGreaterThan(beforeReset);
  const reset = linkIn((await latestMailTo(email)).text);
  const r = await openInFreshBrowser(browser, reset);
  await expect(r.page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  const fresh = `fresh-${stamp}-passphrase`;
  await r.page.getByLabel("New password (12+ characters)").fill(fresh);
  await r.page.getByLabel("Repeat password").fill(fresh);
  await r.page.getByRole("button", { name: "Save new password" }).click();
  await expect(r.page.getByRole("status")).toContainText("Password changed");
  await r.ctx.close();
  await tab.page.reload();
  await expect(tab.page).toHaveURL(/\/login/);
  await tab.ctx.close();

  // Tidy up.
  await row.getByRole("button", { name: "Deactivate" }).click();
});
