import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1). Algorithm 2 = Argon2id.
const OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Used when the user doesn't exist so login timing doesn't reveal which emails are registered. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing-equalisation");
  await verifyPassword(await dummyHash, password);
}
