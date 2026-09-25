import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke tests. Expects the API (:4000) and web dev server (:5173) to be running
// and an account whose credentials are in E2E_EMAIL / E2E_PASSWORD.
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    colorScheme: "dark",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
