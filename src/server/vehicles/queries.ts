import "server-only";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/server/db/client";
import { vehicles, vehicleResponsibilityHistory, fuelLogs, users } from "@/server/db/schema";
import { sumMoney, type Money } from "@/server/money";

const responsibleUser = alias(users, "vehicle_responsible_user");
const historyUser = alias(users, "vehicle_history_user");
const fuelAddedByUser = alias(users, "fuel_log_added_by_user");

export interface VehicleListRow {
  id: string;
  name: string;
  plateNumber: string;
  fuelType: "petrol" | "diesel" | "electric" | "hybrid" | "other";
  isActive: boolean;
  estimatedValue: Money | null;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
}

/**
 * Every vehicle (section 55/58) — active vehicles first, then inactive
 * ones, never hidden entirely since management still needs to see them.
 * The responsible user comes straight from vehicles.defaultResponsibleUserId
 * (a deliberately-kept-in-sync convenience pointer per that column's
 * schema comment), not re-derived from history.
 */
export async function getVehiclesList(): Promise<VehicleListRow[]> {
  const rows = await db
    .select({
      id: vehicles.id,
      name: vehicles.name,
      plateNumber: vehicles.plateNumber,
      fuelType: vehicles.fuelType,
      isActive: vehicles.isActive,
      estimatedValue: vehicles.estimatedValue,
      responsibleUserId: vehicles.defaultResponsibleUserId,
      responsibleUserName: responsibleUser.name,
    })
    .from(vehicles)
    .leftJoin(responsibleUser, eq(vehicles.defaultResponsibleUserId, responsibleUser.id))
    .orderBy(desc(vehicles.isActive), vehicles.name);

  return rows;
}

export interface HistoryRow {
  id: string;
  vehicleId: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string | null;
}

/**
 * Full responsibility history for one vehicle (section 57), most
 * recent/open row first. Never overwritten in place — see
 * assignVehicleResponsibility in ../vehicles/actions.ts, the only writer.
 */
export async function getVehicleResponsibilityHistory(
  vehicleId: string,
): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      id: vehicleResponsibilityHistory.id,
      vehicleId: vehicleResponsibilityHistory.vehicleId,
      userId: vehicleResponsibilityHistory.userId,
      userName: historyUser.name,
      startDate: vehicleResponsibilityHistory.startDate,
      endDate: vehicleResponsibilityHistory.endDate,
    })
    .from(vehicleResponsibilityHistory)
    .innerJoin(historyUser, eq(vehicleResponsibilityHistory.userId, historyUser.id))
    .where(eq(vehicleResponsibilityHistory.vehicleId, vehicleId))
    // Open row (endDate IS NULL) first, then most recent startDate first.
    .orderBy(sql`${vehicleResponsibilityHistory.endDate} IS NULL DESC`, desc(vehicleResponsibilityHistory.startDate));

  return rows;
}

export interface FuelLog {
  id: string;
  vehicleId: string;
  addedByUserId: string;
  addedByUserName: string;
  amount: Money;
  fuelType: "petrol" | "diesel" | "electric" | "hybrid" | "other";
  liters: string | null;
  mileage: number | null;
  receiptPhotoTaken: boolean;
  notes: string | null;
  loggedAt: Date;
}

function monthRangeUtc(month: string): { start: Date; end: Date } {
  // month is "YYYY-MM"
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  return { start, end };
}

function currentMonthString(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Fuel log rows for one vehicle, newest first, optionally restricted to a "YYYY-MM" month. */
export async function getFuelLogsForVehicle(
  vehicleId: string,
  filters?: { month?: string },
): Promise<FuelLog[]> {
  const conditions = [eq(fuelLogs.vehicleId, vehicleId)];
  if (filters?.month) {
    const { start, end } = monthRangeUtc(filters.month);
    conditions.push(gte(fuelLogs.loggedAt, start), lt(fuelLogs.loggedAt, end));
  }

  const rows = await db
    .select({
      id: fuelLogs.id,
      vehicleId: fuelLogs.vehicleId,
      addedByUserId: fuelLogs.addedByUserId,
      addedByUserName: fuelAddedByUser.name,
      amount: fuelLogs.amount,
      fuelType: fuelLogs.fuelType,
      liters: fuelLogs.liters,
      mileage: fuelLogs.mileage,
      receiptPhotoTaken: fuelLogs.receiptPhotoTaken,
      notes: fuelLogs.notes,
      loggedAt: fuelLogs.loggedAt,
    })
    .from(fuelLogs)
    .innerJoin(fuelAddedByUser, eq(fuelLogs.addedByUserId, fuelAddedByUser.id))
    .where(and(...conditions))
    .orderBy(desc(fuelLogs.loggedAt));

  return rows;
}

export interface VehicleCostSummary {
  /** Sum of fuel_logs.amount for the current calendar month. */
  monthlyFuelTotal: Money;
  /**
   * Total running cost to date. Honestly equal to total fuel cost: this
   * schema has no separate maintenance/other-cost table for vehicles, and
   * nothing else in the codebase records a vehicle maintenance cost, so
   * "Maintenance if recorded" (section 58) records nothing today — this
   * is the correct V1 answer, not a gap.
   */
   totalRunningCost: Money;
}

export interface VehicleDetail {
  id: string;
  name: string;
  plateNumber: string;
  fuelType: "petrol" | "diesel" | "electric" | "hybrid" | "other";
  isActive: boolean;
  estimatedValue: Money | null;
  notes: string | null;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  createdAt: Date;
  history: HistoryRow[];
  costSummary: VehicleCostSummary;
}

/** One vehicle's full detail view (section 58): vehicle + history + cost summary. */
export async function getVehicleDetail(vehicleId: string): Promise<VehicleDetail | null> {
  const [vehicleRow] = await db
    .select({
      id: vehicles.id,
      name: vehicles.name,
      plateNumber: vehicles.plateNumber,
      fuelType: vehicles.fuelType,
      isActive: vehicles.isActive,
      estimatedValue: vehicles.estimatedValue,
      notes: vehicles.notes,
      responsibleUserId: vehicles.defaultResponsibleUserId,
      responsibleUserName: responsibleUser.name,
      createdAt: vehicles.createdAt,
    })
    .from(vehicles)
    .leftJoin(responsibleUser, eq(vehicles.defaultResponsibleUserId, responsibleUser.id))
    .where(eq(vehicles.id, vehicleId))
    .limit(1);

  if (!vehicleRow) return null;

  const [history, monthlyLogs, allLogs] = await Promise.all([
    getVehicleResponsibilityHistory(vehicleId),
    getFuelLogsForVehicle(vehicleId, { month: currentMonthString() }),
    getFuelLogsForVehicle(vehicleId),
  ]);

  const costSummary: VehicleCostSummary = {
    monthlyFuelTotal: sumMoney(monthlyLogs.map((l) => l.amount)),
    totalRunningCost: sumMoney(allLogs.map((l) => l.amount)),
  };

  return { ...vehicleRow, history, costSummary };
}
