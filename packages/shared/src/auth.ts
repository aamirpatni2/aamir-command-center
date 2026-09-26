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
