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
  measurementAttachments,
  users,
  externalContractors,
  workTypes,
  glassTypes,
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

/**
 * Whether `userId` may see `jobId` at all — VIEW_ALL_JOBS bypasses this
 * (caller must check that separately), otherwise true only if the same
 * involvementFilter used everywhere else in this file matches. Sprint 1
 * security hardening: several job-scoped Server Actions (createMeasurement
 * chief among them) previously checked only a permission KEY, never
 * whether the caller could already see the job — letting a restricted
 * user, e.g., self-grant future visibility into an arbitrary job by
 * setting themselves as its measuredByUserId. Call this before trusting
 * any client-supplied jobId in a mutation.
 */
export async function isJobVisibleToUser(jobId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), involvementFilter(userId)))
    .limit(1);
  return !!row;
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

  const [items, assignments, measurementRows, attachmentRows] = await Promise.all([
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
        // New Measurement quick-submit flow fields (spec section 4) — all
        // null on an ordinary office-recorded measurement.
        glassTypeId: measurements.glassTypeId,
        glassTypeLabelAr: glassTypes.labelAr,
        // Reference-only, never summed into anything — see the column's
        // own comment in src/server/db/schema/jobs.ts. Display as entered,
        // e.g. "₪2,500 · شامل الضريبة", never fed into money.ts arithmetic.
        fieldQuotedPrice: measurements.fieldQuotedPrice,
        fieldQuotedPriceIncludesVat: measurements.fieldQuotedPriceIncludesVat,
      })
      .from(measurements)
      .innerJoin(users, eq(measurements.measuredByUserId, users.id))
      .leftJoin(glassTypes, eq(measurements.glassTypeId, glassTypes.id))
      .where(eq(measurements.jobId, jobId))
      .orderBy(desc(measurements.measuredAt)),
    db
      .select({
        id: measurementAttachments.id,
        measurementId: measurementAttachments.measurementId,
        fileName: measurementAttachments.fileName,
        mimeType: measurementAttachments.mimeType,
        sizeBytes: measurementAttachments.sizeBytes,
        createdAt: measurementAttachments.createdAt,
      })
      .from(measurementAttachments)
      .innerJoin(measurements, eq(measurementAttachments.measurementId, measurements.id))
      .where(eq(measurements.jobId, jobId))
      .orderBy(measurementAttachments.createdAt),
  ]);

  // Attachments come back with a `url` resolved here (not stored) so the
  // UI never constructs the retrieval path itself — just
  // GET /api/attachments/:attachmentId, the authenticated route in
  // src/app/api/attachments/[attachmentId]/route.ts.
  const measurementsWithAttachments = measurementRows.map((m) => ({
    ...m,
    attachments: attachmentRows
      .filter((a) => a.measurementId === m.id)
      .map((a) => ({ ...a, url: `/api/attachments/${a.id}` })),
  }));

  return { ...job, items, assignments, measurements: measurementsWithAttachments };
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
