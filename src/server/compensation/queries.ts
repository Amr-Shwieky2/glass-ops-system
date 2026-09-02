import "server-only";
import { and, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/server/db/client";
import {
  technicianLedgerEntries,
  compensationRules,
  penaltyRules,
  bonusRules,
  workTypes,
  jobs,
  users,
  userPermissions,
} from "@/server/db/schema";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { sumMoney, type Money } from "@/server/money";

const createdByUser = alias(users, "ledger_created_by_user");
const approvedByUser = alias(users, "ledger_approved_by_user");

export interface CompensationRuleOption {
  id: string;
  label: string;
  unit: string;
  amount: Money;
  workTypeLabelAr: string | null;
}

/** Active installer compensation rates (section 23), ordered by label — the
 * table has no sortOrder column of its own. */
export async function getCompensationRules(): Promise<CompensationRuleOption[]> {
  return db
    .select({
      id: compensationRules.id,
      label: compensationRules.label,
      unit: compensationRules.unit,
      amount: compensationRules.amount,
      workTypeLabelAr: workTypes.labelAr,
    })
    .from(compensationRules)
    .leftJoin(workTypes, eq(compensationRules.workTypeId, workTypes.id))
    .where(eq(compensationRules.isActive, true))
    .orderBy(compensationRules.label);
}

export interface PenaltyRuleOption {
  id: string;
  label: string;
  defaultAmount: Money;
  description: string | null;
}

/** Active penalty rules (section 30), ordered by label. */
export async function getPenaltyRules(): Promise<PenaltyRuleOption[]> {
  return db
    .select({
      id: penaltyRules.id,
      label: penaltyRules.label,
      defaultAmount: penaltyRules.defaultAmount,
      description: penaltyRules.description,
    })
    .from(penaltyRules)
    .where(eq(penaltyRules.isActive, true))
    .orderBy(penaltyRules.label);
}

export interface BonusRuleOption {
  id: string;
  label: string;
  defaultAmount: Money;
  description: string | null;
}

/** Active bonus rules (section 31), ordered by label. */
export async function getBonusRules(): Promise<BonusRuleOption[]> {
  return db
    .select({
      id: bonusRules.id,
      label: bonusRules.label,
      defaultAmount: bonusRules.defaultAmount,
      description: bonusRules.description,
    })
    .from(bonusRules)
    .where(eq(bonusRules.isActive, true))
    .orderBy(bonusRules.label);
}

export interface LedgerEntry {
  id: string;
  entryType: string;
  amount: Money;
  quantity: string | null;
  rateUsed: Money | null;
  description: string | null;
  approvalStatus: string;
  createdAt: Date;
  approvedAt: Date | null;
  relatedJobId: string | null;
  relatedJobNumber: string | null;
  relatedJobItemId: string | null;
  compensationRuleLabel: string | null;
  workTypeLabelAr: string | null;
  penaltyRuleLabel: string | null;
  bonusRuleLabel: string | null;
  createdByUserName: string | null;
  approvedByUserName: string | null;
}

const ledgerEntrySelection = {
  id: technicianLedgerEntries.id,
  entryType: technicianLedgerEntries.entryType,
  amount: technicianLedgerEntries.amount,
  quantity: technicianLedgerEntries.quantity,
  rateUsed: technicianLedgerEntries.rateUsed,
  description: technicianLedgerEntries.description,
  approvalStatus: technicianLedgerEntries.approvalStatus,
  createdAt: technicianLedgerEntries.createdAt,
  approvedAt: technicianLedgerEntries.approvedAt,
  relatedJobId: technicianLedgerEntries.relatedJobId,
  relatedJobItemId: technicianLedgerEntries.relatedJobItemId,
  relatedJobNumber: jobs.jobNumber,
  compensationRuleLabel: compensationRules.label,
  workTypeLabelAr: workTypes.labelAr,
  penaltyRuleLabel: penaltyRules.label,
  bonusRuleLabel: bonusRules.label,
  createdByUserName: createdByUser.name,
  approvedByUserName: approvedByUser.name,
};

function ledgerEntryQuery() {
  return db
    .select(ledgerEntrySelection)
    .from(technicianLedgerEntries)
    .leftJoin(jobs, eq(technicianLedgerEntries.relatedJobId, jobs.id))
    .leftJoin(
      compensationRules,
      eq(technicianLedgerEntries.compensationRuleId, compensationRules.id),
    )
    .leftJoin(workTypes, eq(compensationRules.workTypeId, workTypes.id))
    .leftJoin(penaltyRules, eq(technicianLedgerEntries.penaltyRuleId, penaltyRules.id))
    .leftJoin(bonusRules, eq(technicianLedgerEntries.bonusRuleId, bonusRules.id))
    .leftJoin(createdByUser, eq(technicianLedgerEntries.createdByUserId, createdByUser.id))
    .leftJoin(approvedByUser, eq(technicianLedgerEntries.approvedByUserId, approvedByUser.id));
}

export interface TechnicianLedgerResult {
  entries: LedgerEntry[];
  balance: Money;
}

/**
 * Every ledger entry for one technician, newest first, plus their balance.
 * Balance = SUM(amount) over approvalStatus='approved' rows ONLY — pending
 * and rejected rows never count toward it (section 74, hard rule).
 */
export async function getTechnicianLedger(userId: string): Promise<TechnicianLedgerResult> {
  const entries = await ledgerEntryQuery()
    .where(eq(technicianLedgerEntries.userId, userId))
    .orderBy(desc(technicianLedgerEntries.createdAt));

  const balance = sumMoney(
    entries.filter((e) => e.approvalStatus === "approved").map((e) => e.amount),
  );

  return { entries, balance };
}

export interface TechnicianBalanceSummary {
  userId: string;
  userName: string;
  balance: Money;
}

/**
 * One row per active user worth showing on the technician roster: anyone
 * with at least one ledger entry, plus anyone holding COMPLETE_INSTALLATION
 * (the closest thing this catalogue has to "is a technician") so a
 * newly-added installer with zero activity yet still shows up with a
 * 0.00 balance rather than being invisible until their first entry.
 */
export async function getAllTechniciansBalanceSummary(): Promise<TechnicianBalanceSummary[]> {
  const eligibleUsers = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(
        eq(users.status, "active"),
        isNull(users.deletedAt),
        or(
          exists(
            db
              .select({ one: sql`1` })
              .from(technicianLedgerEntries)
              .where(eq(technicianLedgerEntries.userId, users.id)),
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(userPermissions)
              .where(
                and(
                  eq(userPermissions.userId, users.id),
                  eq(userPermissions.permissionKey, PERMISSIONS.COMPLETE_INSTALLATION),
                ),
              ),
          ),
        ),
      ),
    );

  if (eligibleUsers.length === 0) return [];

  const userIds = eligibleUsers.map((u) => u.id);
  const approvedRows = await db
    .select({
      userId: technicianLedgerEntries.userId,
      amount: technicianLedgerEntries.amount,
    })
    .from(technicianLedgerEntries)
    .where(
      and(
        inArray(technicianLedgerEntries.userId, userIds),
        eq(technicianLedgerEntries.approvalStatus, "approved"),
      ),
    );

  const amountsByUser = new Map<string, Money[]>();
  for (const row of approvedRows) {
    const list = amountsByUser.get(row.userId);
    if (list) list.push(row.amount);
    else amountsByUser.set(row.userId, [row.amount]);
  }

  return eligibleUsers
    .map((u) => ({
      userId: u.id,
      userName: u.name,
      balance: sumMoney(amountsByUser.get(u.id) ?? []),
    }))
    .sort((a, b) => a.userName.localeCompare(b.userName, "ar"));
}

/** Ledger entries tied to one job (Job detail page's compensation section). */
export async function getJobCompensationEntries(jobId: string): Promise<LedgerEntry[]> {
  return ledgerEntryQuery()
    .where(eq(technicianLedgerEntries.relatedJobId, jobId))
    .orderBy(desc(technicianLedgerEntries.createdAt));
}
