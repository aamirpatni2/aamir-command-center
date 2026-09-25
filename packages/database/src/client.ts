import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema, casing: undefined });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
