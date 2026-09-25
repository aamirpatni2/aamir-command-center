import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "e2e/**"],
    // Integration tests share one test database, so run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
