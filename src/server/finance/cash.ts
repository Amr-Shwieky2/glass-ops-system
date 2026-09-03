import "server-only";
import { and, eq } from "drizzle-orm";
import { cashAccounts, cashTransactions } from "@/server/db/schema";
import type { Database } from "@/server/db/client";
import type { Money } from "@/server/money";

/**
 * Every person who can hold company cash gets exactly one cash_accounts
 * row (ownerType='user'), created lazily the first time they receive money
 * (section 34). Always takes a transaction executor so it composes inside
 * a larger transaction (e.g. approving a cash payment) — a cash account
 * must never be created without the transaction that needed it committing
 * too.
 */
export async function getOrCreateCashAccountForUser(
  tx: Database,
  userId: string,
): Promise<string> {
  const [existing] = await tx
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(
      and(eq(cashAccounts.ownerType, "user"), eq(cashAccounts.ownerUserId, userId)),
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(cashAccounts)
    .values({ ownerType: "user", ownerUserId: userId })
    .returning({ id: cashAccounts.id });
  return created.id;
}

/**
 * Posts an 'in' row to a user's cash account (section 34) — e.g. a cash
 * customer payment being approved. Out of scope for this stage: transfers
 * and withdrawals (Phase 8) — this only ever credits money in.
 */
export async function creditCashAccount(
  tx: Database,
  params: {
    userId: string;
    amount: Money;
    sourceType: string;
    sourceId: string;
    notes?: string;
    createdByUserId: string;
  },
): Promise<void> {
  const cashAccountId = await getOrCreateCashAccountForUser(tx, params.userId);
  await tx.insert(cashTransactions).values({
    cashAccountId,
    direction: "in",
    amount: params.amount,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    notes: params.notes,
    createdByUserId: params.createdByUserId,
  });
}

/**
 * Posts an 'out' row to a cash account — the debit counterpart to
 * creditCashAccount, added for field-expense reports (src/server/finance/
 * expense-actions.ts). Takes cashAccountId directly rather than userId:
 * unlike a credit (whose source row only ever carries the receiving
 * user's id), a cash_expense_reports row already stores the account it
 * was reported against, and that account is guaranteed to already exist
 * (it was created, lazily, by getOrCreateCashAccountForUser at report
 * time) — so there is nothing to get-or-create here.
 */
export async function debitCashAccount(
  tx: Database,
  params: {
    cashAccountId: string;
    amount: Money;
    sourceType: string;
    sourceId: string;
    notes?: string;
    createdByUserId: string;
  },
): Promise<void> {
  await tx.insert(cashTransactions).values({
    cashAccountId: params.cashAccountId,
    direction: "out",
    amount: params.amount,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    notes: params.notes,
    createdByUserId: params.createdByUserId,
  });
}
