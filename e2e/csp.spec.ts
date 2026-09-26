import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

// Visits every page and fails on any Content-Security-Policy violation or console error.
// Meaningful against the production server (API serving apps/web/dist with its CSP):
//   E2E_BASE_URL=http://localhost:4100 E2E_EXPECT_CSP=1 pnpm e2e csp
test("every page renders under the production CSP with no violations or console errors", async ({ page }) => {
  const problems: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || "inline"}`);
    });
  });
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`${page.url()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${page.url()}: ${e.message}`));

  const first = await page.goto("/");
  if (process.env.E2E_EXPECT_CSP) {
    expect(first!.headers()["content-security-policy"]).toContain("script-src 'self'");
  }
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeVisible();
  const paths = await nav.getByRole("link").evaluateAll((links) => links.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
  expect(paths.length).toBeGreaterThan(15);

  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
  // Deep link straight into a client-side route (served the app shell by the API in production).
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();

  expect(problems).toEqual([]);
});
