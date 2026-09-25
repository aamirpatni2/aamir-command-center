/**
 * Creates the first owner account. There is no public sign-up.
 * Usage: set OWNER_EMAIL, OWNER_NAME, OWNER_PASSWORD in .env (or the shell), then `pnpm db:create-owner`.
 * Remove OWNER_PASSWORD from .env afterwards.
 */
import { loadEnv } from "@acc/config";
import { createUserRequestSchema } from "@acc/shared";
import { and, eq, isNull } from "drizzle-orm";
import { createDb } from "../src/client.js";
import { hashPassword } from "../src/passwords.js";
import { writeAudit } from "../src/audit.js";
import { users } from "../src/schema/index.js";

const env = loadEnv();
const parsed = createUserRequestSchema.safeParse({
  email: process.env.OWNER_EMAIL,
  name: process.env.OWNER_NAME,
  password: process.env.OWNER_PASSWORD,
  role: "owner",
});
if (!parsed.success) {
  console.error("✖ OWNER_EMAIL, OWNER_NAME and OWNER_PASSWORD (12+ chars) are required.");
  for (const i of parsed.error.issues) console.error(`  - ${i.path.join(".")}: ${i.message}`);
  process.exit(1);
}

const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
try {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, parsed.data.email), isNull(users.deletedAt)));
  if (existing.length > 0) {
    console.log(`ℹ user ${parsed.data.email} already exists — nothing to do.`);
  } else {
    const [row] = await db
      .insert(users)
      .values({
        email: parsed.data.email,
        name: parsed.data.name,
        role: "owner",
        passwordHash: await hashPassword(parsed.data.password),
      })
      .returning({ id: users.id });
    await writeAudit(db, { actorType: "system", action: "user.bootstrap_owner", entityType: "user", entityId: row!.id });
    console.log(`✔ owner ${parsed.data.email} created. Now remove OWNER_PASSWORD from your .env.`);
  }
} finally {
  await close();
}
