"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { cashAccounts, cashTransactions, cashTransfers, users, userPermissions } from "@/server/db/schema";
import type { Database } from "@/server/db/client";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUsers, notifyUser } from "@/server/notifications";
import { parseNonNegativeMoneyInput, isPositive, formatILS } from "@/server/money";
import { getOrCreateCashAccountForUser } from "@/server/finance/cash";

export interface ActionState {
  error?: string;
  success?: boolean;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

/**
 * Active users holding a given permission — a small local duplicate of the
 * equivalent helper in src/server/payments/record.ts, kept here rather than
 * imported across modules (matches this codebase's low-coupling convention
 * for that helper, per its own comment).
 */
async function getUserIdsWithPermission(permissionKey: PermissionKey): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(userPermissions)
    .innerJoin(users, eq(userPermissions.userId, users.id))
    .where(
      and(
        eq(userPermissions.permissionKey, permissionKey),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * The single ownerType='company' cash account (section 34). Seeding should
 * already have created one, but this creates it lazily if somehow missing —
 * same shape as getOrCreateCashAccountForUser in finance/cash.ts.
 */
async function getOrCreateCompanyCashAccount(tx: Database): Promise<string> {
  const [existing] = await tx
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(eq(cashAccounts.ownerType, "company"))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(cashAccounts)
    .values({ ownerType: "company" })
    .returning({ id: cashAccounts.id });
  return created.id;
}

const CreateCashTransferSchema = z.object({
  toAccountKind: z.enum(["company"]),
  amount: z.string().trim().min(1, { error: "المبلغ مطلوب" }),
  notes: z.string().trim().optional(),
});

/**
 * A user hands over cash they are personally holding (section 35) — V1
 * only supports handing it back to the company account. Needs no
 * permission beyond being logged in: anyone who might be holding company
 * cash (a technician who collected a cash payment, say) must be able to
 * initiate handing it back. Does NOT move any balance by itself — see the
 * comment on cashTransfers in schema/finance.ts — that only happens once
 * confirmCashTransfer runs.
 */
export async function createCashTransfer(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "يجب تسجيل الدخول." };

  const parsed = CreateCashTransferSchema.safeParse({
    toAccountKind: formData.get("toAccountKind"),
    amount: formData.get("amount"),
    notes: emptyToUndefined(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const amount = parseNonNegativeMoneyInput(parsed.data.amount);
  if (amount === null || !isPositive(amount)) {
    return { error: "المبلغ غير صحيح" };
  }

  const transferId = await db.transaction(async (tx) => {
    const fromCashAccountId = await getOrCreateCashAccountForUser(tx, user.id);
    const toCashAccountId = await getOrCreateCompanyCashAccount(tx);

    const [transfer] = await tx
      .insert(cashTransfers)
      .values({
        fromCashAccountId,
        toCashAccountId,
        amount,
        transferredAt: new Date(),
        notes: parsed.data.notes,
        createdByUserId: user.id,
      })
      .returning({ id: cashTransfers.id });

    await recordAudit(
      {
        userId: user.id,
        action: "cash_transfer.create",
        entityType: "cash_transfer",
        entityId: transfer.id,
        newValue: { fromCashAccountId, toCashAccountId, amount },
      },
      tx,
    );

    return transfer.id;
  });

  const approverIds = await getUserIdsWithPermission(PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS);
  await notifyUsers(approverIds, {
    type: "cash_transfer_pending_confirmation",
    title: `تسليم نقدية بمبلغ ${formatILS(amount)} بانتظار التأكيد`,
    relatedEntityType: "cash_transfer",
    relatedEntityId: transferId,
  });

  revalidatePath("/finance/cash");
  return { success: true };
}

/**
 * Confirms a cash handover (section 35) — the ONE place that sets
 * cash_transfers.confirmedAt and posts the matching 'out'/'in'
 * cash_transactions pair. Race-safe against a double confirm (double
 * click, two approvers): the UPDATE only affects a row still
 * confirmedAt IS NULL, and its returned row count is the real guard — the
 * rest of the transaction only runs if that update actually won the race.
 */
export async function confirmCashTransfer(
  transferId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS)) {
    return { error: "لا تملك صلاحية تأكيد تسليم النقدية." };
  }

  const [transfer] = await db
    .select()
    .from(cashTransfers)
    .where(eq(cashTransfers.id, transferId))
    .limit(1);
  if (!transfer) return { error: "عملية التسليم غير موجودة." };
  if (transfer.confirmedAt !== null) {
    return { error: "تم تأكيد هذه العملية بالفعل." };
  }

  const now = new Date();
  let alreadyConfirmed = false;

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(cashTransfers)
      .set({ confirmedByUserId: user!.id, confirmedAt: now })
      .where(and(eq(cashTransfers.id, transferId), isNull(cashTransfers.confirmedAt)))
      .returning({ id: cashTransfers.id });

    if (!updated) {
      alreadyConfirmed = true;
      return;
    }

    await tx.insert(cashTransactions).values([
      {
        cashAccountId: transfer.fromCashAccountId,
        direction: "out",
        amount: transfer.amount,
        sourceType: "transfer",
        sourceId: transfer.id,
        createdByUserId: user!.id,
      },
      {
        cashAccountId: transfer.toCashAccountId,
        direction: "in",
        amount: transfer.amount,
        sourceType: "transfer",
        sourceId: transfer.id,
        createdByUserId: user!.id,
      },
    ]);

    await recordAudit(
      {
        userId: user!.id,
        action: "cash_transfer.confirm",
        entityType: "cash_transfer",
        entityId: transfer.id,
        newValue: { amount: transfer.amount },
      },
      tx,
    );
  });

  if (alreadyConfirmed) {
    return { error: "تم تأكيد هذه العملية بالفعل." };
  }

  if (transfer.createdByUserId) {
    await notifyUser({
      userId: transfer.createdByUserId,
      type: "cash_transfer_confirmed",
      title: `تم تأكيد تسليم النقدية بمبلغ ${formatILS(transfer.amount)}`,
      relatedEntityType: "cash_transfer",
      relatedEntityId: transfer.id,
    });
  }

  revalidatePath("/finance/cash");
  return { success: true };
}
