import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  jobStatuses,
  workTypes,
  glassTypes,
  compensationRules,
  penaltyRules,
  bonusRules,
} from "@/server/db/schema";
import type { Money } from "@/server/money";

/**
 * "Including inactive" listers for the Settings admin screens (section
 * 77/13/21/23/30/31). The active-only equivalents already used for
 * dropdowns elsewhere (src/server/jobs/queries.ts's getAllJobStatuses /
 * getAllWorkTypes, src/server/compensation/queries.ts's
 * getCompensationRules / getPenaltyRules / getBonusRules) filter to
 * isActive=true with no way to opt out, and their selections are shaped
 * for a `<select>` (few columns, work type resolved to its Arabic label)
 * rather than for an editable admin table (every column, raw
 * workTypeId) — so these are separate, deliberately thin, functions
 * rather than a parameter bolted onto the existing ones.
 */

/** All job statuses (active and inactive), in display order. */
export async function getAllJobStatusesIncludingInactive() {
  return db.select().from(jobStatuses).orderBy(jobStatuses.sortOrder);
}

/** All work types (active and inactive), in display order. */
export async function getAllWorkTypesIncludingInactive() {
  return db.select().from(workTypes).orderBy(workTypes.sortOrder);
}

/** All glass types (active and inactive), in display order. */
export async function getAllGlassTypesIncludingInactive() {
  return db.select().from(glassTypes).orderBy(glassTypes.sortOrder);
}

export interface CompensationRuleAdminRow {
  id: string;
  workTypeId: string | null;
  label: string;
  unit: string;
  amount: Money;
  isActive: boolean;
  workTypeLabelAr: string | null;
}

/** All compensation rules (active and inactive), ordered by label. */
export async function getAllCompensationRulesIncludingInactive(): Promise<
  CompensationRuleAdminRow[]
> {
  return db
    .select({
      id: compensationRules.id,
      workTypeId: compensationRules.workTypeId,
      label: compensationRules.label,
      unit: compensationRules.unit,
      amount: compensationRules.amount,
      isActive: compensationRules.isActive,
      workTypeLabelAr: workTypes.labelAr,
    })
    .from(compensationRules)
    .leftJoin(workTypes, eq(compensationRules.workTypeId, workTypes.id))
    .orderBy(compensationRules.label);
}

export interface PenaltyRuleAdminRow {
  id: string;
  label: string;
  defaultAmount: Money;
  description: string | null;
  isActive: boolean;
}

/** All penalty rules (active and inactive), ordered by label. */
export async function getAllPenaltyRulesIncludingInactive(): Promise<
  PenaltyRuleAdminRow[]
> {
  return db
    .select({
      id: penaltyRules.id,
      label: penaltyRules.label,
      defaultAmount: penaltyRules.defaultAmount,
      description: penaltyRules.description,
      isActive: penaltyRules.isActive,
    })
    .from(penaltyRules)
    .orderBy(penaltyRules.label);
}

export interface BonusRuleAdminRow {
  id: string;
  label: string;
  defaultAmount: Money;
  description: string | null;
  isActive: boolean;
}

/** All bonus rules (active and inactive), ordered by label. */
export async function getAllBonusRulesIncludingInactive(): Promise<
  BonusRuleAdminRow[]
> {
  return db
    .select({
      id: bonusRules.id,
      label: bonusRules.label,
      defaultAmount: bonusRules.defaultAmount,
      description: bonusRules.description,
      isActive: bonusRules.isActive,
    })
    .from(bonusRules)
    .orderBy(bonusRules.label);
}
