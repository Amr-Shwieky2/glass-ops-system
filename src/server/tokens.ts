// NOTE: deliberately no `import "server-only"` here — pure crypto helpers,
// also used by the standalone seed script (runs outside Next.js's bundler).
import { randomBytes, createHash } from "node:crypto";

/**
 * Secure random tokens for session cookies and public links (quote signing,
 * factory submission). 32 bytes = 256 bits of entropy, URL-safe base64 —
 * not guessable, and distinct from any database row id.
 */
export function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Session cookies are stored server-side only as this hash (section 75). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizePhone(raw: string): string {
  // Keep a leading + if present, strip everything else non-digit. Accepts
  // local Israeli numbers (05xxxxxxxx) and international (+9725xxxxxxxx)
  // without pretending to fully validate every country's format.
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (hasPlus) return `+${digits}`;
  // Local format starting with a trunk 0 (e.g. 0501234567) -> assume
  // Israel (+972) and drop the trunk zero, the common local convention.
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return `+${digits}`;
}

export function isPlausiblePhone(raw: string): boolean {
  const normalized = normalizePhone(raw);
  return /^\+\d{8,15}$/.test(normalized);
}
