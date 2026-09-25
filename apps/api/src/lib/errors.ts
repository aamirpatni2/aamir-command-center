import type { ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "UNAUTHORIZED", "Authentication required");
export const forbidden = (msg = "You do not have permission to do this") => new HttpError(403, "FORBIDDEN", msg);
export const notFound = (what = "Resource") => new HttpError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (msg: string) => new HttpError(409, "CONFLICT", msg);

/** Validates untrusted input. Unknown keys are stripped by Zod object parsing. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Invalid request",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
