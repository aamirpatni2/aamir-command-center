import pino from "pino";
import { createDb, schema, type DbHandle } from "@acc/database";
import { resetTestDatabase } from "@acc/database/testing";

export const silentLogger = pino({ level: "silent" });

export async function setupDb(): Promise<DbHandle> {
  return createDb(await resetTestDatabase(), { max: 3 });
}

export async function createTask(h: DbHandle, input = "What courses do we offer?") {
  const [t] = await h.db.insert(schema.agentTasks).values({ title: input.slice(0, 60), input }).returning();
  return t!;
}
