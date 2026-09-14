import "server-only";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  cashAccounts,
  cashTransactions,
  cashExpenseReports,
  customerPayments,
  jobs,
  users,
} from "@/server/db/schema";
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
  createdByUserName: string | null;
  /** Only ever set for sourceType='customer_payment' — the payment's own
   * job. Every other sourceType (transfer/adjustment/field_expense) has no
   * job relationship in the schema (see cashTransactions.sourceId's own
   * comment), so this is null for those, not a best-effort guess. */
  relatedJobNumber: string | null;
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

export interface CashTransactionFilters {
  /** Inclusive lower bound on createdAt. */
  dateFrom?: Date;
  /** Inclusive upper bound on createdAt. */
  dateTo?: Date;
  direction?: "in" | "out";
  /** Inclusive lower bound on amount. */
  minAmount?: Money;
  /** Inclusive upper bound on amount. */
  maxAmount?: Money;
  /** A specific job's transactions only — resolved against the ONE
   * sourceType that actually has a job relationship (see
   * CashTransaction.relatedJobNumber's own comment); a job with no
   * customer-payment-sourced cash transaction correctly returns nothing. */
  jobId?: string;
}

/**
 * Full transaction history of one cash account, newest first (detail
 * view/audit — section 34/35, S6.6's per-amount/per-Job/per-creator
 * filters). Optional filters compose in SQL, not in JS, so a filtered view
 * never has to fetch-then-discard rows. `createdByUserName` and
 * `relatedJobNumber` are resolved here (not left for the UI to guess at)
 * so a management screen can actually display who created a movement and
 * which job it relates to, not just an opaque sourceType/sourceId pair.
 */
export async function getCashTransactionHistory(
  cashAccountId: string,
  filters: CashTransactionFilters = {},
): Promise<CashTransaction[]> {
  const conditions = [eq(cashTransactions.cashAccountId, cashAccountId)];
  if (filters.dateFrom) conditions.push(gte(cashTransactions.createdAt, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(cashTransactions.createdAt, filters.dateTo));
  if (filters.direction) conditions.push(eq(cashTransactions.direction, filters.direction));
  if (filters.minAmount) conditions.push(gte(cashTransactions.amount, filters.minAmount));
  if (filters.maxAmount) conditions.push(lte(cashTransactions.amount, filters.maxAmount));
  if (filters.jobId) {
    const jobPaymentIds = await db
      .select({ id: customerPayments.id })
      .from(customerPayments)
      .where(eq(customerPayments.jobId, filters.jobId));
    // No customer-payment-sourced cash transaction exists for this job at
    // all — short-circuit rather than build an inArray([]) (which some
    // drivers treat as "match nothing" and others as a SQL error).
    if (jobPaymentIds.length === 0) return [];
    conditions.push(
      and(
        eq(cashTransactions.sourceType, "customer_payment"),
        inArray(cashTransactions.sourceId, jobPaymentIds.map((p) => p.id)),
      )!,
    );
  }

  const rows = await db
    .select({
      id: cashTransactions.id,
      cashAccountId: cashTransactions.cashAccountId,
      direction: cashTransactions.direction,
      amount: cashTransactions.amount,
      sourceType: cashTransactions.sourceType,
      sourceId: cashTransactions.sourceId,
      notes: cashTransactions.notes,
      createdByUserId: cashTransactions.createdByUserId,
      createdByUserName: users.name,
      createdAt: cashTransactions.createdAt,
    })
    .from(cashTransactions)
    .leftJoin(users, eq(cashTransactions.createdByUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(cashTransactions.createdAt));

  const paymentSourceIds = rows
    .filter((r) => r.sourceType === "customer_payment" && r.sourceId)
    .map((r) => r.sourceId!);
  const jobByPaymentId = new Map<string, string>();
  if (paymentSourceIds.length > 0) {
    const paymentJobRows = await db
      .select({ paymentId: customerPayments.id, jobNumber: jobs.jobNumber })
      .from(customerPayments)
      .innerJoin(jobs, eq(customerPayments.jobId, jobs.id))
      .where(inArray(customerPayments.id, paymentSourceIds));
    for (const r of paymentJobRows) jobByPaymentId.set(r.paymentId, r.jobNumber);
  }

  return rows.map((r) => ({
    ...r,
    relatedJobNumber:
      r.sourceType === "customer_payment" && r.sourceId
        ? (jobByPaymentId.get(r.sourceId) ?? null)
        : null,
  }));
}

/**
 * The cash_accounts.id for a user's cash box, or null if they don't have
 * one yet (lazily created on first cash movement — see
 * getOrCreateCashAccountForUser in cash.ts, the write-path counterpart).
 * A read-only lookup: never creates the account.
 */
export async function getCashAccountIdForUser(userId: string): Promise<string | null> {
  const [account] = await db
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(eq(cashAccounts.ownerUserId, userId))
    .limit(1);
  return account?.id ?? null;
}

export interface PendingFieldExpense {
  id: string;
  cashAccountId: string;
  amount: Money;
  description: string;
  reportedByUserId: string;
  reportedByName: string;
  createdAt: Date;
}

/**
 * Pending field-expense reports (src/server/finance/expense-actions.ts),
 * newest first, optionally scoped to one cash account — the cash-drawer
 * page only ever shows the account being viewed. A read-only index, same
 * spirit as getPendingApprovalRequests: never approves/rejects anything,
 * the real decision controls live behind decideFieldExpenseAction.
 */
export async function getPendingFieldExpenses(
  cashAccountId?: string,
): Promise<PendingFieldExpense[]> {
  const conditions = [eq(cashExpenseReports.status, "pending")];
  if (cashAccountId) conditions.push(eq(cashExpenseReports.cashAccountId, cashAccountId));

  return db
    .select({
      id: cashExpenseReports.id,
      cashAccountId: cashExpenseReports.cashAccountId,
      amount: cashExpenseReports.amount,
      description: cashExpenseReports.description,
      reportedByUserId: cashExpenseReports.reportedByUserId,
      reportedByName: users.name,
      createdAt: cashExpenseReports.createdAt,
    })
    .from(cashExpenseReports)
    .innerJoin(users, eq(cashExpenseReports.reportedByUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(cashExpenseReports.createdAt));
}
