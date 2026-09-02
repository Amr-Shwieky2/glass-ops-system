import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { incomingChecks, outgoingChecks, customers, jobs } from "@/server/db/schema";
import { db } from "@/server/db/client";
import { getSetting } from "@/server/settings";
import type { Money } from "@/server/money";

/**
 * Whether a check's due date is within `thresholdDays` of today (section
 * 39). Deliberately also true for an already-overdue check (a negative
 * day count) — an overdue check is at least as urgent as a "due soon" one,
 * and the UI stage uses this single helper for both the automatic
 * incoming-check status ('future' -> 'due_soon') and highlighting either
 * kind of check regardless of its stored status.
 */
export function isCheckDueSoon(dueDate: string | Date, thresholdDays: number): boolean {
  const due = typeof dueDate === "string" ? new Date(`${dueDate}T00:00:00`) : dueDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  return diffDays <= thresholdDays;
}

export interface IncomingCheckRow {
  id: string;
  customerId: string;
  customerName: string;
  jobId: string | null;
  jobNumber: string | null;
  amount: Money;
  checkNumber: string | null;
  bank: string | null;
  dueDate: string;
  status: "future" | "due_soon" | "deposited" | "cleared" | "failed" | "cancelled";
  notes: string | null;
  isDueSoon: boolean;
  createdAt: Date;
}

export interface OutgoingCheckRow {
  id: string;
  payeeName: string;
  jobId: string | null;
  jobNumber: string | null;
  amount: Money;
  checkNumber: string | null;
  dueDate: string;
  reason: string | null;
  status: "pending" | "issued" | "cleared" | "failed" | "cancelled";
  notes: string | null;
  isDueSoon: boolean;
  createdAt: Date;
}

/** Checks received from customers (section 37), soonest due date first. */
export async function getIncomingChecks(filters?: {
  status?: IncomingCheckRow["status"];
  customerId?: string;
  jobId?: string;
}): Promise<IncomingCheckRow[]> {
  const thresholdDays = (await getSetting("notification_thresholds")).checkDueSoonDays;

  const conditions = [
    filters?.status ? eq(incomingChecks.status, filters.status) : undefined,
    filters?.customerId ? eq(incomingChecks.customerId, filters.customerId) : undefined,
    filters?.jobId ? eq(incomingChecks.jobId, filters.jobId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await db
    .select({
      id: incomingChecks.id,
      customerId: incomingChecks.customerId,
      customerName: customers.name,
      jobId: incomingChecks.jobId,
      jobNumber: jobs.jobNumber,
      amount: incomingChecks.amount,
      checkNumber: incomingChecks.checkNumber,
      bank: incomingChecks.bank,
      dueDate: incomingChecks.dueDate,
      status: incomingChecks.status,
      notes: incomingChecks.notes,
      createdAt: incomingChecks.createdAt,
    })
    .from(incomingChecks)
    .innerJoin(customers, eq(incomingChecks.customerId, customers.id))
    .leftJoin(jobs, eq(incomingChecks.jobId, jobs.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(incomingChecks.dueDate));

  return rows.map((r) => ({ ...r, isDueSoon: isCheckDueSoon(r.dueDate, thresholdDays) }));
}

/** Company-issued checks (section 38), soonest due date first. */
export async function getOutgoingChecks(filters?: {
  status?: OutgoingCheckRow["status"];
  jobId?: string;
}): Promise<OutgoingCheckRow[]> {
  const thresholdDays = (await getSetting("notification_thresholds")).checkDueSoonDays;

  const conditions = [
    filters?.status ? eq(outgoingChecks.status, filters.status) : undefined,
    filters?.jobId ? eq(outgoingChecks.jobId, filters.jobId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await db
    .select({
      id: outgoingChecks.id,
      payeeName: outgoingChecks.payeeName,
      jobId: outgoingChecks.jobId,
      jobNumber: jobs.jobNumber,
      amount: outgoingChecks.amount,
      checkNumber: outgoingChecks.checkNumber,
      dueDate: outgoingChecks.dueDate,
      reason: outgoingChecks.reason,
      status: outgoingChecks.status,
      notes: outgoingChecks.notes,
      createdAt: outgoingChecks.createdAt,
    })
    .from(outgoingChecks)
    .leftJoin(jobs, eq(outgoingChecks.jobId, jobs.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(outgoingChecks.dueDate));

  return rows.map((r) => ({ ...r, isDueSoon: isCheckDueSoon(r.dueDate, thresholdDays) }));
}
