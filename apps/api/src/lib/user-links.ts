/**
 * Single-use emailed links (invite, password reset). The token appears only in the email and in
 * the URL fragment (#…), which browsers never send to servers, so it can't land in logs or
 * Referer headers. Only an HMAC of it is stored.
 */
import { and, eq, gt, isNull, schema, sql, type Database } from "@acc/database";
import type { LinkPurpose } from "@acc/shared";
import { hashToken, randomToken } from "./tokens.js";

export const LINK_TTL_MS: Record<LinkPurpose, number> = { invite: 72 * 3600_000, reset: 60 * 60_000 };

export function linkUrl(publicUrl: string, token: string) {
  return `${publicUrl.replace(/\/$/, "")}/invite#${token}`;
}

/** Revokes the user's open links of this purpose (or all purposes) and returns how many. */
export async function revokeOpenLinks(db: Database, userId: string, purpose?: LinkPurpose) {
  const rows = await db
    .update(schema.userTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.userTokens.userId, userId), isNull(schema.userTokens.usedAt), isNull(schema.userTokens.revokedAt), purpose ? eq(schema.userTokens.purpose, purpose) : undefined))
    .returning({ id: schema.userTokens.id });
  return rows.length;
}

/** Issues a new link; any earlier open link of the same purpose stops working. */
export async function issueLink(db: Database, secret: string, p: { userId: string; purpose: LinkPurpose; sentTo: string; createdBy: string }) {
  await revokeOpenLinks(db, p.userId, p.purpose);
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + LINK_TTL_MS[p.purpose]);
  await db.insert(schema.userTokens).values({ userId: p.userId, purpose: p.purpose, tokenHash: hashToken(token, secret), sentTo: p.sentTo, expiresAt, createdBy: p.createdBy });
  return { token, expiresAt };
}

/** The link's row and user, if it is still usable: unused, unrevoked, unexpired, user active, email unchanged. */
export async function findUsableLink(db: Database, secret: string, token: string) {
  const [row] = await db
    .select({ link: schema.userTokens, user: schema.users })
    .from(schema.userTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.userTokens.userId))
    .where(
      and(
        eq(schema.userTokens.tokenHash, hashToken(token, secret)),
        isNull(schema.userTokens.usedAt),
        isNull(schema.userTokens.revokedAt),
        gt(schema.userTokens.expiresAt, new Date()),
        eq(schema.users.isActive, true),
        isNull(schema.users.deletedAt),
        sql`${schema.userTokens.sentTo} = ${schema.users.email}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Marks the link used exactly once (a concurrent second use gets false). */
export async function consumeLink(db: Database, linkId: string) {
  const rows = await db
    .update(schema.userTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.userTokens.id, linkId), isNull(schema.userTokens.usedAt), isNull(schema.userTokens.revokedAt), gt(schema.userTokens.expiresAt, new Date())))
    .returning({ id: schema.userTokens.id });
  return rows.length === 1;
}

/** Pending invites per user (open, not used), for the Team page. */
export async function pendingInvites(db: Database) {
  const rows = await db
    .select({ userId: schema.userTokens.userId, expiresAt: schema.userTokens.expiresAt })
    .from(schema.userTokens)
    .where(and(eq(schema.userTokens.purpose, "invite"), isNull(schema.userTokens.usedAt), isNull(schema.userTokens.revokedAt)));
  return new Map(rows.map((r) => [r.userId, r.expiresAt]));
}
