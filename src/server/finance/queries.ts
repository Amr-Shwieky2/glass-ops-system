import "server-only";
import { desc, eq } from "drizzle-orm";
import { cashAccounts, cashTransactions, users } from "@/server/db/schema";
import { db } from "@/server/db/client";
import { sumMoney, subtractMoney, type Money } from "@/server/money";

export interface CashAccountBalance {
  accountId: string;
  ownerType: "user" | "company";
  ownerUserId: string | null;
  /** null for the single ownerType='company' account. */
  ownerName: string | null;
  balance: Money;
}

export interface CashTransaction {
  id: string;
  cashAccountId: string;
  direction: "in" | "out";
  amount: Money;
  sourceType: string;
  sourceId: string | null;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}

/**
 * Balance of every cash account in the system (section 34/35) — every
 * cash_accounts row (both 'user' and the single 'company' row), balance
 * computed as SUM('in') - SUM('out') over cash_transactions. Balance is
 * never a stored column (see the comment on cashAccounts in
 * schema/finance.ts) — always derived here, via money.ts, never raw JS
 * arithmetic.
 */
export async function getCashAccountBalances(): Promise<CashAccountBalance[]> {
  const [accounts, transactions] = await Promise.all([
    db
      .select({
        id: cashAccounts.id,
        ownerType: cashAccounts.ownerType,
        ownerUserId: cashAccounts.ownerUserId,
        ownerName: users.name,
      })
      .from(cashAccounts)
      .leftJoin(users, eq(cashAccounts.ownerUserId, users.id)),
    db
      .select({
        cashAccountId: cashTransactions.cashAccountId,
        direction: cashTransactions.direction,
        amount: cashTransactions.amount,
      })
      .from(cashTransactions),
  ]);

  const inByAccount = new Map<string, Money[]>();
  const outByAccount = new Map<string, Money[]>();
  for (const t of transactions) {
    const bucket = t.direction === "in" ? inByAccount : outByAccount;
    const list = bucket.get(t.cashAccountId) ?? [];
    list.push(t.amount);
    bucket.set(t.cashAccountId, list);
  }

  return accounts.map((account) => ({
    accountId: account.id,
    ownerType: account.ownerType,
    ownerUserId: account.ownerUserId,
    ownerName: account.ownerName,
    balance: subtractMoney(
      sumMoney(inByAccount.get(account.id) ?? []),
      sumMoney(outByAccount.get(account.id) ?? []),
    ),
  }));
}

/**
 * Balance of a single user's cash account. Lazily returns "0.00" when the
 * user has no cash_accounts row yet (or has one but no transactions) —
 * never requires an account to already exist, unlike
 * getOrCreateCashAccountForUser (which is for the write path only).
 */
export async function getCashAccountBalanceForUser(userId: string): Promise<Money> {
  const [account] = await db
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(eq(cashAccounts.ownerUserId, userId))
    .limit(1);
  if (!account) return "0.00";

  const transactions = await db
    .select({ direction: cashTransactions.direction, amount: cashTransactions.amount })
    .from(cashTransactions)
    .where(eq(cashTransactions.cashAccountId, account.id));

  const totalIn = sumMoney(transactions.filter((t) => t.direction === "in").map((t) => t.amount));
  const totalOut = sumMoney(transactions.filter((t) => t.direction === "out").map((t) => t.amount));
  return subtractMoney(totalIn, totalOut);
}

/** Full transaction history of one cash account, newest first (detail view). */
export async function getCashTransactionHistory(
  cashAccountId: string,
): Promise<CashTransaction[]> {
  return db
    .select({
      id: cashTransactions.id,
      cashAccountId: cashTransactions.cashAccountId,
      direction: cashTransactions.direction,
      amount: cashTransactions.amount,
      sourceType: cashTransactions.sourceType,
      sourceId: cashTransactions.sourceId,
      notes: cashTransactions.notes,
      createdByUserId: cashTransactions.createdByUserId,
      createdAt: cashTransactions.createdAt,
    })
    .from(cashTransactions)
    .where(eq(cashTransactions.cashAccountId, cashAccountId))
    .orderBy(desc(cashTransactions.createdAt));
}
