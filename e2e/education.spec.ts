import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_EMAIL, "set E2E_EMAIL and E2E_PASSWORD");

test("course → batch → enrol → class attendance → payment → verify → certificate", async ({ page }, info) => {
  const stamp = Date.now().toString(36);
  const phone = `0321${String(Date.now()).slice(-7)}`; // unique student per run

  await page.goto("/courses");
  await page.getByRole("button", { name: "New course" }).click();
  await page.getByLabel("Title").fill(`E2E Practical AI ${stamp}`);
  await page.getByLabel("Slug (url name)").fill(`e2e-ai-${stamp}`);
  await page.getByLabel("Standard price (PKR)").fill("8000");
  await page.getByLabel("Status").selectOption("active");
  await page.getByRole("button", { name: "Create course" }).click();

  const card = page.locator("section", { hasText: `E2E Practical AI ${stamp}` });
  await card.getByRole("button", { name: "Add batch" }).click();
  await card.getByLabel("Batch name").fill("Batch E2E");
  await card.getByLabel("Early-bird price (PKR)").fill("5000");
  await card.getByLabel("Early-bird until").fill("2099-12-31");
  await card.getByRole("button", { name: "Add batch" }).click();
  await expect(card.getByText("early-bird until 2099-12-31")).toBeVisible();
  await expect(card.getByText("PKR 5,000")).toBeVisible();
  await page.screenshot({ path: `e2e/.results/courses-${info.project.name}.png`, fullPage: true });

  await card.getByRole("link", { name: "Batch E2E" }).click();
  await page.getByLabel("Phone").fill(phone);
  await page.getByLabel("Name", { exact: true }).fill("Zara Ahmed");
  await page.getByRole("button", { name: "Enrol" }).click();
  await expect(page.getByRole("link", { name: "Zara Ahmed" })).toBeVisible();

  await page.getByLabel("Title").first().fill("Intro to AI");
  await page.getByLabel("Starts (PKT)").fill("2026-01-10T20:00");
  await page.getByRole("button", { name: "Add" }).first().click();
  await page.getByRole("button", { name: /attendance \(0\/1\)/ }).click();
  await page.getByRole("group", { name: "Attendance for Zara Ahmed" }).getByRole("button", { name: "present" }).click();
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(page.getByRole("cell", { name: "1/1 (100%)" })).toBeVisible();
  await page.screenshot({ path: `e2e/.results/batch-${info.project.name}.png`, fullPage: true });

  await page.getByRole("link", { name: "Zara Ahmed" }).click();
  await page.getByLabel("Amount (PKR)").fill("5000");
  await page.getByLabel("Reference / TID").fill(`TID-${stamp}`);
  await page.getByRole("button", { name: /Record payment/ }).click();
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Issue certificate" }).click();
  await expect(page.getByText("Certificate issued")).toBeVisible();
  await page.screenshot({ path: `e2e/.results/student-${info.project.name}.png`, fullPage: true });
});
