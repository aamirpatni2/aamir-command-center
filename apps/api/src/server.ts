import { loadEnv } from "@acc/config";
import { createDb } from "@acc/database";
import { buildApp } from "./app.js";

const env = loadEnv();
const handle = createDb(env.DATABASE_URL);
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
