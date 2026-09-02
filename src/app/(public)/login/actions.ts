"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { verifyPassword } from "@/server/auth/password";
import { normalizePhone } from "@/server/tokens";
import { createSession } from "@/server/auth/session";

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
      return { error: GENERIC_ERROR };
    }

    const passwordOk = await verifyPassword(
      parsed.data.password,
      row.passwordHash,
    );
    if (!passwordOk) {
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
