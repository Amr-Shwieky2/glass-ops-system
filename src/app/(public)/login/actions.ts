"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { verifyPassword } from "@/server/auth/password";
import { normalizePhone } from "@/server/tokens";
import { createSession } from "@/server/auth/session";
import { checkRateLimit, isBlocked } from "@/server/security/rate-limit";

export interface LoginFormState {
  error?: string;
}

const LoginSchema = z.object({
  phone: z.string().min(1, { error: "أدخل رقم الهاتف" }),
  password: z.string().min(1, { error: "أدخل كلمة المرور" }),
});

// Deliberately identical wording for "no such phone" and "wrong password" —
// distinguishing the two would let an attacker enumerate registered phone
// numbers. Suspension gets its own message: only reachable after a correct
// password, so it doesn't leak anything the visitor didn't already know.
const GENERIC_ERROR = "رقم الهاتف أو كلمة المرور غير صحيحة.";
const SUSPENDED_ERROR = "تم تعليق هذا الحساب. يرجى التواصل مع الإدارة.";
const UNEXPECTED_ERROR = "حدث خطأ غير متوقع. حاول مرة أخرى.";
const TOO_MANY_ATTEMPTS_ERROR = "محاولات كثيرة جداً. حاول مرة أخرى بعد قليل.";

// Two independent limits, both must pass: per-phone (protects one account
// regardless of which IP the guesses come from — the more important of
// the two, since X-Forwarded-For is spoofable, see below) and per-IP
// (slows down guessing spread across many phone numbers from one source).
// 5 failures / 15 minutes, then blocked for 15 minutes — generous enough
// for a real person mistyping a password, tight enough to make brute
// force impractical. Deliberately counts only FAILED attempts (wrong
// password / unknown phone), never successes: a busy, entirely legitimate
// login volume (many people signing in through one office connection,
// which collapses to one IP bucket whenever no reverse proxy sets
// X-Forwarded-For — true of this app's own local/dev setup) must never
// itself trip the limiter.
const PHONE_LIMIT = { maxAttempts: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const IP_LIMIT = { maxAttempts: 20, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };

async function clientIp(): Promise<string> {
  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

function safeRedirectTarget(raw: FormDataEntryValue | null): string {
  if (
    typeof raw !== "string" ||
    !raw.startsWith("/") ||
    raw.startsWith("//")
  ) {
    return "/dashboard";
  }
  return raw;
}

export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = LoginSchema.safeParse({
    phone: formData.get("phone"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const target = safeRedirectTarget(formData.get("redirect"));
  const ip = await clientIp();
  const phoneKey = `login:phone:${normalizedPhone}`;
  const ipKey = `login:ip:${ip}`;

  // Read-only pre-check — does not itself count as an attempt, so it can
  // never accumulate from being called on every request.
  if (!isBlocked(phoneKey).allowed || !isBlocked(ipKey).allowed) {
    return { error: TOO_MANY_ATTEMPTS_ERROR };
  }

  let userId: string;

  try {
    const rows = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        status: users.status,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.phone, normalizedPhone))
      .limit(1);

    const row = rows[0];
    if (!row || row.deletedAt) {
      checkRateLimit(phoneKey, PHONE_LIMIT);
      checkRateLimit(ipKey, IP_LIMIT);
      return { error: GENERIC_ERROR };
    }

    const passwordOk = await verifyPassword(
      parsed.data.password,
      row.passwordHash,
    );
    if (!passwordOk) {
      checkRateLimit(phoneKey, PHONE_LIMIT);
      checkRateLimit(ipKey, IP_LIMIT);
      return { error: GENERIC_ERROR };
    }

    if (row.status !== "active") {
      return { error: SUSPENDED_ERROR };
    }

    userId = row.id;
  } catch (err) {
    console.error("[login] unexpected error", err);
    return { error: UNEXPECTED_ERROR };
  }

  // createSession() + redirect() run OUTSIDE the try/catch above: redirect()
  // throws a special Next.js control-flow signal that must propagate up,
  // never be swallowed by a catch block.
  await createSession(userId);
  redirect(target);
}
