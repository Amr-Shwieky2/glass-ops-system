import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runAllScheduledChecks } from "@/server/scheduler/conditions";

/**
 * Internal trigger for the scheduled-notification sweep (Sprint 4 — the
 * free/self-hosted scheduler docker-compose.yml's own header comment used
 * to flag as missing). Not a public/token route: it is meant to be called
 * ONLY by the `scheduler` service in docker-compose.yml, a small polling
 * loop running in the SAME Docker network, over the compose-internal
 * hostname (never published to a host port) — see that file's `scheduler`
 * service for the exact call. It runs inside this same already-built,
 * already-traced Next.js server (not a separate build/deploy artifact),
 * so it reuses the exact same business logic, permissions data, and
 * database connection every other route already does.
 *
 * Gated by a shared secret (`SCHEDULER_SECRET`, compared in constant time
 * to resist timing attacks) rather than a session — there is no logged-in
 * user driving this call, the same posture as the public quote/factory
 * token routes, except here the "token" is an operator-provisioned
 * deployment secret, not something handed to an external party. Fails
 * CLOSED: an unset or empty SCHEDULER_SECRET refuses every request rather
 * than silently accepting unauthenticated triggers.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a same-length comparison so the early return above doesn't
    // leak length via timing on top of a leaked length via response shape
    // (the response is generic 401 either way, but this costs nothing).
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function POST(request: Request) {
  const expected = process.env.SCHEDULER_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Scheduler not configured." }, { status: 503 });
  }
  const provided = request.headers.get("x-scheduler-secret") ?? "";
  if (!timingSafeStringEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const failures = await runAllScheduledChecks();
  if (failures.length > 0) {
    console.error("[scheduler] condition(s) failed:", failures);
  }
  return NextResponse.json({ ok: true, failures });
}
