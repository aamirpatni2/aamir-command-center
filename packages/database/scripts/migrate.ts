import { loadEnv } from "@acc/config";
import { runMigrations } from "../src/migrate.js";

const env = loadEnv();
await runMigrations(env.DATABASE_URL);
console.log("✔ migrations applied");
