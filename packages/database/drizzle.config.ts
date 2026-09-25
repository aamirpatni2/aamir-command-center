import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://acc:acc_dev_password@localhost:5432/acc_dev" },
  strict: true,
  verbose: true,
});
