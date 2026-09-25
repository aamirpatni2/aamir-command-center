/**
 * Test helpers. Resets the dedicated test database. Refuses to run against
 * anything whose name doesn't end in `_test`.
 */
import postgres from "postgres";
import { runMigrations } from "./migrate.js";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://acc:acc_dev_password@localhost:5432/acc_test";
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) throw new Error(`Refusing to reset non-test database "${name}"`);
  return url;
}

export async function resetTestDatabase(): Promise<string> {
  const url = testDatabaseUrl();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    // Drop our tables and enum types but keep extensions (installed by a superuser).
    await sql.unsafe(`
      DO $$ DECLARE r record; BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
          EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
        FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP
          EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
        END LOOP;
      END $$;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
    `);
  } finally {
    await sql.end({ timeout: 5 });
  }
  await runMigrations(url);
  return url;
}
