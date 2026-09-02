// NOTE: deliberately no `import "server-only"` here — this module is pure
// crypto with no ambient secrets/connections (unlike db/client.ts or
// session.ts), and it must also load from the standalone seed script
// (src/server/db/seed.ts) which runs outside Next.js's bundler via tsx.
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Minimum bar for a new/changed password. Kept simple and stated plainly. */
export function passwordMeetsPolicy(plain: string): boolean {
  return typeof plain === "string" && plain.length >= 8;
}
