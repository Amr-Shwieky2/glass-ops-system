import "server-only";
import { and, eq } from "drizzle-orm";
import { cashAccounts, cashTransactions } from "@/server/db/schema";
import type { Database } from "@/server/db/client";
import { sumMoney, subtractMoney, isNegative, type Money } from "@/server/money";

/** Thrown by assertSufficientCashBalance (Sprint 6 — cash drawers must
 * never go negative). Callers catch this specifically and turn it into a
 * user-facing Arabic error instead of letting it surface as an
 * unhandled 500; throwing (rather than returning a result flag) also
 * rolls back everything else the same transaction already did, so a
 * refused debit never leaves a half-applied status change behind. */
export class InsufficientCashBalanceError extends Error {
  constructor(
    public readonly availableBalance: Money,
    public readonly requestedAmount: Money,
  ) {
    super(
      `Insufficient cash balance: available ${availableBalance}, requested ${requestedAmount}`,
    );
    this.name = "InsufficientCashBalanceError";
  }
}

/**
 * Locks the account row (`SELECT ... FOR UPDATE OF cash_accounts`) and
 * refuses (throws InsufficientCashBalanceError) if debiting `amount` would
 * take its computed balance below zero (section 34/35 — a cash drawer
 * must never go negative; live-reproducible before this check existed by
 * transferring/reporting an expense larger than what was actually on
 * hand). The lock is what actually makes this race-safe: without it, two
 * concurrent debits against the same account could each read the same
 * "balance is fine" snapshot under READ COMMITTED and both proceed,
 * together driving it negative — locking the account row forces a second,
 * concurrent debit attempt to wait until this transaction commits (or
 * rolls back) before it can even read the balance, the same pattern
 * lockJobForWrite already uses for job rows (src/server/jobs/locking.ts).
 * `tx` must already be inside a transaction; call this BEFORE inserting
 * the debiting cash_transactions row(s), never after.
 */
export async function assertSufficientCashBalance(
  tx: Database,
  cashAccountId: string,
  amount: Money,
): Promise<void> {
  await tx
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(eq(cashAccounts.id, cashAccountId))
    .for("update", { of: cashAccounts });

  const transactions = await tx
    .select({ direction: cashTransactions.direction, amount: cashTransactions.amount })
    .from(cashTransactions)
    .where(eq(cashTransactions.cashAccountId, cashAccountId));

  const totalIn = sumMoney(transactions.filter((t) => t.direction === "in").map((t) => t.amount));
  const totalOut = sumMoney(
    transactions.filter((t) => t.direction === "out").map((t) => t.amount),
  );
  const balance = subtractMoney(totalIn, totalOut);
  const remainingAfterDebit = subtractMoney(balance, amount);
  if (isNegative(remainingAfterDebit)) {
    throw new InsufficientCashBalanceError(balance, amount);
  }
}

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
  await assertSufficientCashBalance(tx, params.cashAccountId, params.amount);
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
