import { loadEnv } from "@acc/config";
import { runMigrations } from "../src/migrate.js";
import { grantAppRole } from "../src/app-role.js";

// Migrations need the owner. In production DATABASE_URL is the least-privilege app role and
// MIGRATION_DATABASE_URL the owner; locally they are the same.
const env = loadEnv();
const ownerUrl = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;
await runMigrations(ownerUrl);
console.log("✔ migrations applied");
if (env.APP_DB_PASSWORD) {
  await grantAppRole(ownerUrl, { role: env.APP_DB_ROLE, password: env.APP_DB_PASSWORD });
  console.log(`✔ app role "${env.APP_DB_ROLE}" can read and write rows only`);
}
