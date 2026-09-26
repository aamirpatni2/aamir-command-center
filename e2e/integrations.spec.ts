import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

// Local dev: no Google/Canva/WhatsApp-sending credentials, the filesystem MCP server from mcp.config.json.
test("integrations: honest status, setup steps, live MCP server and allow-listed tools", async ({ page }, info) => {
  await page.goto("/mcp");
  await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();

  const google = page.locator("section").filter({ has: page.getByRole("heading", { name: "Google Workspace" }) });
  await expect(google.getByText("Not configured")).toBeVisible();
  await expect(google.getByText(/\/api\/integrations\/oauth\/callback/)).toBeVisible();
  await expect(google.getByText("GOOGLE_CLIENT_ID")).toBeVisible();

  const files = page.locator("section").filter({ has: page.getByRole("heading", { name: /Course files/ }) });
  await expect(files.getByText("Connected").first()).toBeVisible({ timeout: 15_000 });
  await expect(files.getByText("read_text_file")).toBeVisible();
  await expect(files.getByText(/other tool\(s\) offered by the server are not exposed/)).toBeVisible();
  await files.getByRole("button", { name: "Reconnect & test" }).click();
  await expect(files.getByText("Connected").first()).toBeVisible({ timeout: 15_000 });

  // Template sync without credentials explains exactly what's missing.
  await page.getByRole("button", { name: "Sync from WhatsApp" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /WHATSAPP_ACCESS_TOKEN/ })).toBeVisible();
  await page.screenshot({ path: `e2e/.results/integrations-${info.project.name}.png`, fullPage: true });
});
