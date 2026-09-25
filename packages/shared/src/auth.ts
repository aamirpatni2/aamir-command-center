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
