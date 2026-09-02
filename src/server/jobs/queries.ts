import "server-only";
import { and, count, desc, eq, exists, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  jobs,
  jobStatuses,
  customers,
  jobItems,
  jobAssignments,
  measurements,
  users,
  externalContractors,
  workTypes,
} from "@/server/db/schema";

/** Jobs a restricted (VIEW_ASSIGNED_JOBS-only) viewer is "involved in" —
 * assigned to install, or the one who measured / priced / closed it
 * (section 16's three independent commercial-responsibility fields). */
export function involvementFilter(viewerUserId: string) {
  return or(
    eq(jobs.measuredByUserId, viewerUserId),
    eq(jobs.pricingResponsibleUserId, viewerUserId),
    eq(jobs.dealClosedByUserId, viewerUserId),
    exists(
      db
        .select({ one: sql`1` })
        .from(jobAssignments)
        .where(
          and(
            eq(jobAssignments.jobId, jobs.id),
            eq(jobAssignments.userId, viewerUserId),
          ),
        ),
    ),
  );
}

export interface ListJobsParams {
  search?: string;
  statusKey?: string;
  /** Set when the viewer only has VIEW_ASSIGNED_JOBS, not VIEW_ALL_JOBS. */
  restrictToUserId?: string;
  limit?: number;
  offset?: number;
}

export async function listJobs(params: ListJobsParams) {
  const { search, statusKey, restrictToUserId, limit = 25, offset = 0 } = params;

  const conditions = [isNull(jobs.deletedAt)];
  const term = search?.trim();
  if (term) {
    const pattern = `%${term}%`;
    conditions.push(
      or(
        ilike(jobs.jobNumber, pattern),
        ilike(customers.name, pattern),
        ilike(customers.phone, pattern),
      )!,
    );
  }
  if (statusKey) {
    conditions.push(eq(jobStatuses.key, statusKey));
  }
  if (restrictToUserId) {
    conditions.push(involvementFilter(restrictToUserId)!);
  }
  const where = and(...conditions);

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: jobs.id,
        jobNumber: jobs.jobNumber,
        title: jobs.title,
        createdAt: jobs.createdAt,
        salePriceTotal: jobs.salePriceTotal,
        customerId: customers.id,
        customerName: customers.name,
        customerPhone: customers.phone,
        statusKey: jobStatuses.key,
        statusLabelAr: jobStatuses.labelAr,
      })
      .from(jobs)
      .innerJoin(customers, eq(jobs.customerId, customers.id))
      .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
      .where(where)
      .orderBy(desc(jobs.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(jobs)
      .innerJoin(customers, eq(jobs.customerId, customers.id))
      .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
      .where(where),
  ]);

  return { rows, total };
}

export async function getAllJobStatuses() {
  return db
    .select()
    .from(jobStatuses)
    .where(eq(jobStatuses.isActive, true))
    .orderBy(jobStatuses.sortOrder);
}

export async function getAllWorkTypes() {
  return db
    .select()
    .from(workTypes)
    .where(eq(workTypes.isActive, true))
    .orderBy(workTypes.sortOrder);
}

export async function getJobDetail(jobId: string) {
  const rows = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      title: jobs.title,
      address: jobs.address,
      notes: jobs.notes,
      salePriceTotal: jobs.salePriceTotal,
      createdAt: jobs.createdAt,
      closedAt: jobs.closedAt,
      measuredByUserId: jobs.measuredByUserId,
      pricingResponsibleUserId: jobs.pricingResponsibleUserId,
      dealClosedByUserId: jobs.dealClosedByUserId,
      quoteId: jobs.quoteId,
      sourceQuoteVersionId: jobs.sourceQuoteVersionId,
      // Job's own coordinates override the customer's — same convention as
      // jobs.address itself (see the comment in schema/jobs.ts). Resolving
      // the override is left to the caller/UI (Call/Waze/Maps buttons).
      latitude: jobs.latitude,
      longitude: jobs.longitude,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerAddress: customers.address,
      customerLatitude: customers.latitude,
      customerLongitude: customers.longitude,
      customerGoogleMapsUrl: customers.googleMapsUrl,
      statusId: jobStatuses.id,
      statusKey: jobStatuses.key,
      statusLabelAr: jobStatuses.labelAr,
      isTerminal: jobStatuses.isTerminal,
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)))
    .limit(1);

  const job = rows[0];
  if (!job) return null;

  const [items, assignments, measurementRows] = await Promise.all([
    db
      .select({
        id: jobItems.id,
        description: jobItems.description,
        quantity: jobItems.quantity,
        unit: jobItems.unit,
        salePrice: jobItems.salePrice,
        expectedCost: jobItems.expectedCost,
        status: jobItems.status,
        workTypeLabelAr: workTypes.labelAr,
      })
      .from(jobItems)
      .leftJoin(workTypes, eq(jobItems.workTypeId, workTypes.id))
      .where(eq(jobItems.jobId, jobId))
      .orderBy(jobItems.createdAt),
    db
      .select({
        id: jobAssignments.id,
        jobItemId: jobAssignments.jobItemId,
        role: jobAssignments.role,
        assignedAt: jobAssignments.assignedAt,
        userId: jobAssignments.userId,
        userName: users.name,
        externalContractorName: externalContractors.name,
      })
      .from(jobAssignments)
      .leftJoin(users, eq(jobAssignments.userId, users.id))
      .leftJoin(
        externalContractors,
        eq(jobAssignments.externalContractorId, externalContractors.id),
      )
      .where(eq(jobAssignments.jobId, jobId))
      .orderBy(jobAssignments.assignedAt),
    db
      .select({
        id: measurements.id,
        measuredAt: measurements.measuredAt,
        details: measurements.details,
        photosTaken: measurements.photosTaken,
        measuredByName: users.name,
        pricingResponsibleUserId: measurements.pricingResponsibleUserId,
      })
      .from(measurements)
      .innerJoin(users, eq(measurements.measuredByUserId, users.id))
      .where(eq(measurements.jobId, jobId))
      .orderBy(desc(measurements.measuredAt)),
  ]);

  return { ...job, items, assignments, measurements: measurementRows };
}

/** Every active user, for assignment / measurement-responsibility pickers. */
export async function getAssignableUsers() {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.status, "active"), isNull(users.deletedAt)))
    .orderBy(users.name);
}

/** Active external contractors, for the assignment picker (section 49). */
export async function getActiveExternalContractors() {
  return db
    .select({ id: externalContractors.id, name: externalContractors.name })
    .from(externalContractors)
    .where(eq(externalContractors.isActive, true))
    .orderBy(externalContractors.name);
}
