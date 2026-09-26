import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "e2e/**"],
    // Integration tests share one test database, so run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["apps/api/src/**/*.ts", "apps/worker/src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/test/**", "**/*.d.ts", "packages/database/src/schema/**", "packages/ui/**", "apps/api/src/server.ts"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
