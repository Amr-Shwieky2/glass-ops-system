import "server-only";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/server/db/client";
import { customerPayments, jobs, users } from "@/server/db/schema";
import { sumMoney, subtractMoney, type Money } from "@/server/money";

const receivedByUser = alias(users, "payment_received_by_user");
const createdByUser = alias(users, "payment_created_by_user");

export interface JobPayment {
  id: string;
  amount: Money;
  paymentDate: string;
  method: string;
  approvalStatus: string;
  notes: string | null;
  receivedByUserName: string;
  createdByUserName: string | null;
  createdAt: Date;
}

export interface JobPaymentsResult {
  payments: JobPayment[];
  totalApproved: Money;
  /** null when the job has no sale_price_total yet — there is nothing to
   * be "remaining" against. */
  remaining: Money | null;
}

/**
 * Every payment on a job (approved AND pending, newest first) plus the
 * computed totals for the job header. Only approvalStatus='approved' rows
 * count toward totalApproved/remaining — a pending payment is not yet
 * real money (ARCHITECTURE.md section 5's financial-integrity rule).
 */
export async function getJobPayments(jobId: string): Promise<JobPaymentsResult> {
  const [payments, jobRows] = await Promise.all([
    db
      .select({
        id: customerPayments.id,
        amount: customerPayments.amount,
        paymentDate: customerPayments.paymentDate,
        method: customerPayments.method,
        approvalStatus: customerPayments.approvalStatus,
        notes: customerPayments.notes,
        receivedByUserName: receivedByUser.name,
        createdByUserName: createdByUser.name,
        createdAt: customerPayments.createdAt,
      })
      .from(customerPayments)
      .innerJoin(receivedByUser, eq(customerPayments.receivedByUserId, receivedByUser.id))
      .leftJoin(createdByUser, eq(customerPayments.createdByUserId, createdByUser.id))
      .where(eq(customerPayments.jobId, jobId))
      .orderBy(desc(customerPayments.createdAt)),
    db
      .select({ salePriceTotal: jobs.salePriceTotal })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1),
  ]);

  const totalApproved = sumMoney(
    payments
      .filter((p) => p.approvalStatus === "approved")
      .map((p) => p.amount),
  );

  const salePriceTotal = jobRows[0]?.salePriceTotal ?? null;
  const remaining = salePriceTotal
    ? subtractMoney(salePriceTotal, totalApproved)
    : null;

  return { payments, totalApproved, remaining };
}
