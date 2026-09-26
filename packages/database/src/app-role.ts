/**
 * Least-privilege database role for the running app (API + worker). Migrations run as the
 * owner; the app connects as this role, which can read and write rows but cannot change the
 * schema, truncate tables, drop the audit-log trigger, or alter/delete audit entries.
 * Idempotent: run after every migration so new tables are covered.
 */
import postgres from "postgres";
import { sql as dsql } from "drizzle-orm";
import type { DbOrTx } from "./crm.js";

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export async function grantAppRole(ownerUrl: string, opts: { role: string; password: string }): Promise<void> {
  if (!ROLE_NAME.test(opts.role)) throw new Error(`Invalid role name "${opts.role}"`);
  if (opts.password.length < 16) throw new Error("The app database password must be at least 16 characters");
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    const role = sql(opts.role);
    const [exists] = await sql`select 1 from pg_roles where rolname = ${opts.role}`;
    // Utility statements can't take bind parameters: let Postgres quote the password.
    const [row] = await sql<{ stmt: string }[]>`
      select format(${exists ? "alter role %I with login password %L" : "create role %I with login nosuperuser nocreatedb nocreaterole noinherit password %L"}, ${opts.role}::text, ${opts.password}::text) as stmt`;
    await sql.unsafe(row!.stmt);

    const [cur] = await sql<{ db: string }[]>`select current_database() as db`;
    const db = cur!.db;
    await sql`grant connect on database ${sql(db)} to ${role}`;
    await sql`revoke create on schema public from ${role}`;
    await sql`grant usage on schema public to ${role}`;
    await sql`revoke all on all tables in schema public from ${role}`;
    await sql`grant select, insert, update, delete on all tables in schema public to ${role}`;
    // Append-only audit trail (the trigger enforces it too, but the role never gets the right).
    await sql`revoke update, delete on audit_logs from ${role}`;
    await sql`grant usage, select on all sequences in schema public to ${role}`;
    // Tables created by later migrations get the same rights even before this runs again.
    await sql`alter default privileges in schema public grant select, insert, update, delete on tables to ${role}`;
    await sql`alter default privileges in schema public grant usage, select on sequences to ${role}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Builds the app's connection string from the owner's URL (same host and database). */
export function appDatabaseUrl(ownerUrl: string, role: string, password: string): string {
  const u = new URL(ownerUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

/** What the current connection is allowed to do, for the production start-up check. */
export async function inspectDatabaseRole(db: DbOrTx) {
  const rows = await db.execute<{ user: string; superuser: boolean; ownedTables: number }>(dsql`
    select current_user as "user", r.rolsuper as superuser,
      (select count(*)::int from pg_tables where schemaname = 'public' and tableowner = current_user) as "ownedTables"
    from pg_roles r where r.rolname = current_user`);
  return rows[0]!;
}

/**
 * Production guard: the app must not connect as a superuser or as the owner of the tables
 * (an owner can drop the audit-log trigger). Returns the problem, or null when fine.
 */
export async function leastPrivilegeProblem(db: DbOrTx): Promise<string | null> {
  const r = await inspectDatabaseRole(db);
  if (r.superuser) return `the app connects to Postgres as superuser "${r.user}"`;
  if (r.ownedTables > 0) return `the app connects to Postgres as "${r.user}", which owns ${r.ownedTables} tables`;
  return null;
}
