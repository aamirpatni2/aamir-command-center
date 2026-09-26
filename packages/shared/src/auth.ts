import { z } from "zod";
import { ROLES } from "./roles.js";

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Password policy for new accounts. */
export const newPasswordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(256);

/** A short list of the most common passwords that meet the length rule (they are guessed first). */
const COMMON = ["password1234", "123456789012", "qwertyuiop12", "passwordpassword", "iloveyou1234", "pakistan1234", "pakistan@123", "admin1234567", "welcome12345", "letmein12345"];

/** Beyond length: not a common password, not the email, not the same as before, not one repeated character. */
export function weakPasswordReason(pw: string, email: string, previous?: string): string | null {
  const lower = pw.toLowerCase();
  const local = email.split("@")[0]!.toLowerCase();
  if (COMMON.includes(lower)) return "This password is too common";
  if (local.length >= 4 && lower.includes(local)) return "Don't use your email in the password";
  if (previous !== undefined && pw === previous) return "Choose a password you haven't used here";
  if (/^(.)\1+$/.test(pw)) return "Don't repeat one character";
  return null;
}

export const createUserRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(120),
  role: z.enum(ROLES),
  password: newPasswordSchema,
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/** Adding a team member: either the owner sets a temporary password, or an invite link is emailed. */
export const addMemberRequestSchema = createUserRequestSchema
  .extend({ password: newPasswordSchema.optional(), sendInvite: z.boolean().optional() })
  .refine((v) => (v.sendInvite === true) !== (v.password !== undefined), "Either set a temporary password or send an invite, not both");
export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>;

/** Emailed links carry a 256-bit base64url token (43 characters). */
export const linkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid link");
export const acceptLinkSchema = z.object({ token: linkTokenSchema, password: newPasswordSchema });
export type LinkPurpose = "invite" | "reset";
export interface LinkInfo {
  purpose: LinkPurpose;
  name: string;
  email: string;
  expiresAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: (typeof ROLES)[number];
}

export interface SessionResponse {
  user: PublicUser;
  csrfToken: string;
  permissions: string[];
}
