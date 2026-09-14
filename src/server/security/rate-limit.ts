import "server-only";

/**
 * In-memory fixed-window rate limiter. Deliberately not backed by Redis or
 * any external service (section 1's "no paid SaaS" rule extends to not
 * *requiring* infrastructure beyond Postgres for a self-hosted V1) — this
 * is correct for the documented single-instance Docker Compose deployment
 * (one `app` container) and is NOT safe across multiple app replicas,
 * since each process would keep its own counters. If this app is ever
 * scaled horizontally, replace the Map below with a shared store.
 *
 * Login (section 75) and the public token endpoints (quote signing/PDF,
 * factory submission) had no throttling at all — a live probe during the
 * Sprint 0 audit demonstrated 25 unthrottled wrong-password attempts
 * against a real account, and 25 unthrottled hits on a PDF endpoint that
 * spins up a real headless-Chromium render per call.
 */

interface Bucket {
  count: number;
  windowStart: number;
  blockedUntil: number | null;
}

const buckets = new Map<string, Bucket>();

// Defense against unbounded memory growth from an attacker cycling through
// many distinct keys (e.g. many phone numbers or forged tokens): once the
// map gets large, drop the oldest-started buckets first.
const MAX_BUCKETS = 20_000;
const PRUNE_TO = 15_000;

function pruneIfNeeded(): void {
  if (buckets.size <= MAX_BUCKETS) return;
  const entries = Array.from(buckets.entries()).sort(
    (a, b) => a[1].windowStart - b[1].windowStart,
  );
  const toDelete = entries.slice(0, entries.length - PRUNE_TO);
  for (const [key] of toDelete) buckets.delete(key);
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before trying again. 0 when allowed. */
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  /** Attempts allowed within one window before blocking. */
  maxAttempts: number;
  /** Window length, in milliseconds, that attempts are counted over. */
  windowMs: number;
  /** How long a key stays blocked once it exceeds maxAttempts, in ms. */
  blockMs: number;
}

/** Read-only: is `key` currently blocked? Never increments anything —
 * safe to call speculatively, e.g. as a pre-check before doing real work. */
export function isBlocked(key: string): RateLimitResult {
  const bucket = buckets.get(key);
  const now = Date.now();
  if (bucket?.blockedUntil && now < bucket.blockedUntil) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.blockedUntil - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Records one attempt against `key` and reports whether it's allowed.
 * Call this once per attempt (e.g. once per login POST) — it both checks
 * AND increments, so a caller must not call it speculatively.
 */
export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (existing?.blockedUntil && now < existing.blockedUntil) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.blockedUntil - now) / 1000),
    };
  }

  const bucket: Bucket =
    existing && now - existing.windowStart < opts.windowMs
      ? existing
      : { count: 0, windowStart: now, blockedUntil: null };

  bucket.count += 1;

  if (bucket.count > opts.maxAttempts) {
    bucket.blockedUntil = now + opts.blockMs;
    buckets.set(key, bucket);
    pruneIfNeeded();
    return { allowed: false, retryAfterSeconds: Math.ceil(opts.blockMs / 1000) };
  }

  buckets.set(key, bucket);
  pruneIfNeeded();
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Clears a key's counter entirely — call on a successful login so a
 * legitimate user who mistyped their password a few times isn't left
 * partway toward a block. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
