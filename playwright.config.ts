import { defineConfig, devices } from "@playwright/test";

// End-to-end tests. Expect the API (:4000), worker and web dev server (:5173) to be running,
// and an owner account in E2E_EMAIL / E2E_PASSWORD. `setup` signs in once; shell.spec tests the login form itself.
const STATE = "e2e/.auth/owner.json";
const common = {
  baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
  colorScheme: "dark" as const,
  // For a local production stack on https://localhost (Caddy's internal certificate).
  ignoreHTTPSErrors: !!process.env.E2E_IGNORE_HTTPS_ERRORS,
  launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  use: common,
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "login", testMatch: /shell\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "login-mobile", testMatch: /shell\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    {
      name: "desktop",
      testIgnore: [/shell\.spec\.ts/, /auth\.setup\.ts/],
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: STATE },
    },
  ],
});
