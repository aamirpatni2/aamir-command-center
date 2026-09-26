import { loadEnv } from "@acc/config";
import { createDb, leastPrivilegeProblem } from "@acc/database";
import { buildApp } from "./app.js";

const env = loadEnv();
const handle = createDb(env.DATABASE_URL);
if (env.NODE_ENV === "production" && !env.ACC_ALLOW_OWNER_DB) {
  const problem = await leastPrivilegeProblem(handle.db);
  if (problem) {
    console.error(`✖ Refusing to start: ${problem}. Point DATABASE_URL at the app role (see docs/DEPLOYMENT.md) or set ACC_ALLOW_OWNER_DB=true.`);
    process.exit(1);
  }
}
const app = await buildApp({ env, db: handle.db });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: env.API_HOST, port: env.API_PORT });
