import "server-only";
import { asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/server/db/client";
import { cashTransfers, cashAccounts, users } from "@/server/db/schema";
import type { Money } from "@/server/money";

export interface UserBasicInfo {
  id: string;
  name: string;
  status: "active" | "suspended";
}

/**
 * No existing "single user by id" query was found anywhere in the
 * codebase to reuse (only bulk/permission-joined lists) — this is the
 * first one, kept local to this UI area since it's only needed for the
 * technician ledger page's header. Returns null for a nonexistent id
 * rather than throwing, so the page can render a clean "not found" state.
 */
export async function getUserBasicInfo(userId: string): Promise<UserBasicInfo | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Local to this UI area (not src/server/finance/queries.ts, which the
 * finance backend agent already committed) — a small read model for the
 * "pending cash handovers" list this page needs that wasn't part of that
 * agent's report. Keeping it here avoids touching a file outside the
 * src/app/(app)/finance/ tree this stage was scoped to.
 */
export interface PendingCashTransferRow {
  id: string;
  amount: Money;
  notes: string | null;
  createdAt: Date;
  fromCashAccountId: string;
  fromUserId: string | null;
  fromUserName: string | null;
}

/** Unconfirmed cash_transfers rows (section 35), oldest first. */
export async function getPendingCashTransfers(): Promise<PendingCashTransferRow[]> {
  const fromAccount = alias(cashAccounts, "pending_transfer_from_account");
  const fromUser = alias(users, "pending_transfer_from_user");

  return db
    .select({
      id: cashTransfers.id,
      amount: cashTransfers.amount,
      notes: cashTransfers.notes,
      createdAt: cashTransfers.createdAt,
      fromCashAccountId: cashTransfers.fromCashAccountId,
      fromUserId: fromAccount.ownerUserId,
      fromUserName: fromUser.name,
    })
    .from(cashTransfers)
    .innerJoin(fromAccount, eq(cashTransfers.fromCashAccountId, fromAccount.id))
    .leftJoin(fromUser, eq(fromAccount.ownerUserId, fromUser.id))
    .where(isNull(cashTransfers.confirmedAt))
    .orderBy(asc(cashTransfers.createdAt));
}
