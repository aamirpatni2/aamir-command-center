import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appDatabaseUrl, createDb, grantAppRole, inspectDatabaseRole, schema, sql, type DbHandle } from "./index.js";
import { resetTestDatabase } from "./testing.js";

const ROLE = "acc_app_test";
const PASSWORD = "app-role-test-password-123";
let owner: DbHandle;
let app: DbHandle;

beforeAll(async () => {
  const url = await resetTestDatabase();
  owner = createDb(url, { max: 1 });
  await grantAppRole(url, { role: ROLE, password: PASSWORD });
  // Idempotent: a second run (after the next migration) must not fail.
  await grantAppRole(url, { role: ROLE, password: PASSWORD });
  app = createDb(appDatabaseUrl(url, ROLE, PASSWORD), { max: 1 });
});
afterAll(async () => {
  await app?.close();
  await owner?.close();
});

const denied = (e: unknown) => /permission denied|must be owner|append-only/.test(String((e as { cause?: Error }).cause?.message ?? (e as Error).message));

describe("least-privilege app role", () => {
  it("reads and writes rows", async () => {
    const [c] = await app.db.insert(schema.contacts).values({ name: "Role test", phone: "+923009990001" }).returning();
    await app.db.update(schema.contacts).set({ name: "Role test 2" }).where(sql`id = ${c!.id}`);
    await app.db.insert(schema.auditLogs).values({ actorType: "system", action: "role.test" });
    expect((await app.db.select().from(schema.auditLogs)).length).toBeGreaterThan(0);
    await app.db.delete(schema.contacts).where(sql`id = ${c!.id}`);
  });

  it("cannot change the schema, truncate, touch the audit trail or read migration history", async () => {
    await expect(app.db.execute(sql`create table evil (id int)`)).rejects.toSatisfy(denied);
    await expect(app.db.execute(sql`drop table contacts`)).rejects.toSatisfy(denied);
    await expect(app.db.execute(sql`alter table contacts add column x int`)).rejects.toSatisfy(denied);
    await expect(app.db.execute(sql`truncate contacts`)).rejects.toSatisfy(denied);
    await expect(app.db.execute(sql`drop trigger audit_logs_no_update on audit_logs`)).rejects.toSatisfy(denied);
    await expect(app.db.execute(sql`update audit_logs set action = 'x'`)).rejects.toSatisfy(denied);
    await expect(app.db.execute(sql`delete from audit_logs`)).rejects.toSatisfy(denied);
    await expect(app.db.execute(sql`select * from drizzle.__drizzle_migrations`)).rejects.toSatisfy(denied);
  });

  it("the start-up check tells the owner and the app role apart", async () => {
    expect(await inspectDatabaseRole(app.db)).toEqual({ user: ROLE, superuser: false, ownedTables: 0 });
    expect((await inspectDatabaseRole(owner.db)).ownedTables).toBeGreaterThan(10);
  });

  it("rejects bad role names and short passwords", async () => {
    await expect(grantAppRole("postgres://x@localhost/x_test", { role: "bad name; drop", password: PASSWORD })).rejects.toThrow(/Invalid role/);
    await expect(grantAppRole("postgres://x@localhost/x_test", { role: ROLE, password: "short" })).rejects.toThrow(/16/);
  });
});
