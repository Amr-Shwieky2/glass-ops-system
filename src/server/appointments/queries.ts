import "server-only";
import { and, asc, eq, exists, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  appointments,
  appointmentAssignees,
  jobs,
  customers,
  users,
  jobItems,
  workTypes,
} from "@/server/db/schema";

/** appointmentId -> assignee names, in insertion order. Shared by every
 * query below so assignee names are fetched once per appointment set
 * instead of duplicating appointment rows per assignee in a join. */
async function getAssigneeNamesByAppointmentId(
  appointmentIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (appointmentIds.length === 0) return map;
  const rows = await db
    .select({
      appointmentId: appointmentAssignees.appointmentId,
      name: users.name,
    })
    .from(appointmentAssignees)
    .innerJoin(users, eq(appointmentAssignees.userId, users.id))
    .where(inArray(appointmentAssignees.appointmentId, appointmentIds));
  for (const row of rows) {
    const list = map.get(row.appointmentId) ?? [];
    list.push(row.name);
    map.set(row.appointmentId, list);
  }
  return map;
}

export interface CalendarAppointment {
  id: string;
  jobId: string;
  jobNumber: string;
  type: string;
  status: string;
  scheduledStart: Date;
  scheduledEnd: Date | null;
  location: string | null;
  customerName: string;
  customerPhone: string;
  assigneeNames: string[];
}

/**
 * Appointments in [startUtc, endUtc), for the calendar view (section 40).
 * `restrictToUserId` limits to appointments that user is assigned to (a
 * viewer without VIEW_ALL_JOBS should only see their own schedule).
 */
export async function getAppointmentsInRange(params: {
  startUtc: Date;
  endUtc: Date;
  restrictToUserId?: string;
}): Promise<CalendarAppointment[]> {
  const { startUtc, endUtc, restrictToUserId } = params;

  const conditions = [
    gte(appointments.scheduledStart, startUtc),
    lt(appointments.scheduledStart, endUtc),
    ne(appointments.status, "cancelled"),
  ];
  if (restrictToUserId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(appointmentAssignees)
          .where(
            and(
              eq(appointmentAssignees.appointmentId, appointments.id),
              eq(appointmentAssignees.userId, restrictToUserId),
            ),
          ),
      ),
    );
  }

  const rows = await db
    .select({
      id: appointments.id,
      jobId: appointments.jobId,
      jobNumber: jobs.jobNumber,
      type: appointments.type,
      status: appointments.status,
      scheduledStart: appointments.scheduledStart,
      scheduledEnd: appointments.scheduledEnd,
      location: appointments.location,
      jobAddress: jobs.address,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerAddress: customers.address,
    })
    .from(appointments)
    .innerJoin(jobs, eq(appointments.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(asc(appointments.scheduledStart));

  const assigneeNamesByAppointment = await getAssigneeNamesByAppointmentId(
    rows.map((r) => r.id),
  );

  return rows.map((r) => ({
    id: r.id,
    jobId: r.jobId,
    jobNumber: r.jobNumber,
    type: r.type,
    status: r.status,
    scheduledStart: r.scheduledStart,
    scheduledEnd: r.scheduledEnd,
    // appointments.location overrides the job address, which overrides the
    // customer address — same override convention as jobs.address itself.
    location: r.location ?? r.jobAddress ?? r.customerAddress,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    assigneeNames: assigneeNamesByAppointment.get(r.id) ?? [],
  }));
}

export interface MyDayJobItem {
  id: string;
  description: string | null;
  workTypeLabelAr: string | null;
  quantity: string;
  unit: string | null;
  status: string;
}

export interface MyDayAppointment {
  id: string;
  jobId: string;
  jobNumber: string;
  jobTitle: string | null;
  type: string;
  status: string;
  scheduledStart: Date;
  scheduledEnd: Date | null;
  location: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  // Raw, unresolved lat/lng — the job's own value overrides the customer's,
  // same convention as jobs.address (see the comment in schema/jobs.ts);
  // resolving that override is left to the caller/UI, like getJobDetail.
  jobLatitude: string | null;
  jobLongitude: string | null;
  customerLatitude: string | null;
  customerLongitude: string | null;
  customerGoogleMapsUrl: string | null;
  assigneeNames: string[];
  /** Only populated for type='installation' — the job's items not yet
   * installed, for the completion dialog. Empty for every other type. */
  pendingItems: MyDayJobItem[];
}

async function getPendingItemsByJobId(
  jobIds: string[],
): Promise<Map<string, MyDayJobItem[]>> {
  const map = new Map<string, MyDayJobItem[]>();
  if (jobIds.length === 0) return map;
  const rows = await db
    .select({
      jobId: jobItems.jobId,
      id: jobItems.id,
      description: jobItems.description,
      workTypeLabelAr: workTypes.labelAr,
      quantity: jobItems.quantity,
      unit: jobItems.unit,
      status: jobItems.status,
    })
    .from(jobItems)
    .leftJoin(workTypes, eq(jobItems.workTypeId, workTypes.id))
    .where(
      and(
        inArray(jobItems.jobId, jobIds),
        ne(jobItems.status, "installed"),
        ne(jobItems.status, "cancelled"),
      ),
    );
  for (const { jobId, ...item } of rows) {
    const list = map.get(jobId) ?? [];
    list.push(item);
    map.set(jobId, list);
  }
  return map;
}

/**
 * One technician's schedule for a single day (section 41's "My Day"),
 * carrying everything the card needs: call/navigate buttons, and — for
 * installation appointments — the job's still-pending items so the
 * completion dialog can list them without a second round trip.
 */
export async function getMyDayAppointments(
  userId: string,
  dayStartUtc: Date,
  dayEndUtc: Date,
): Promise<MyDayAppointment[]> {
  const rows = await db
    .select({
      id: appointments.id,
      jobId: appointments.jobId,
      jobNumber: jobs.jobNumber,
      jobTitle: jobs.title,
      type: appointments.type,
      status: appointments.status,
      scheduledStart: appointments.scheduledStart,
      scheduledEnd: appointments.scheduledEnd,
      location: appointments.location,
      jobAddress: jobs.address,
      jobLatitude: jobs.latitude,
      jobLongitude: jobs.longitude,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerAddress: customers.address,
      customerLatitude: customers.latitude,
      customerLongitude: customers.longitude,
      customerGoogleMapsUrl: customers.googleMapsUrl,
    })
    .from(appointments)
    .innerJoin(jobs, eq(appointments.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        gte(appointments.scheduledStart, dayStartUtc),
        lt(appointments.scheduledStart, dayEndUtc),
        ne(appointments.status, "cancelled"),
        exists(
          db
            .select({ one: sql`1` })
            .from(appointmentAssignees)
            .where(
              and(
                eq(appointmentAssignees.appointmentId, appointments.id),
                eq(appointmentAssignees.userId, userId),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(appointments.scheduledStart));

  const [assigneeNamesByAppointment, pendingItemsByJob] = await Promise.all([
    getAssigneeNamesByAppointmentId(rows.map((r) => r.id)),
    getPendingItemsByJobId(
      rows.filter((r) => r.type === "installation").map((r) => r.jobId),
    ),
  ]);

  return rows.map((r) => ({
    id: r.id,
    jobId: r.jobId,
    jobNumber: r.jobNumber,
    jobTitle: r.jobTitle,
    type: r.type,
    status: r.status,
    scheduledStart: r.scheduledStart,
    scheduledEnd: r.scheduledEnd,
    location: r.location ?? r.jobAddress ?? r.customerAddress,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerAddress: r.customerAddress,
    jobLatitude: r.jobLatitude,
    jobLongitude: r.jobLongitude,
    customerLatitude: r.customerLatitude,
    customerLongitude: r.customerLongitude,
    customerGoogleMapsUrl: r.customerGoogleMapsUrl,
    assigneeNames: assigneeNamesByAppointment.get(r.id) ?? [],
    pendingItems:
      r.type === "installation" ? pendingItemsByJob.get(r.jobId) ?? [] : [],
  }));
}

export interface JobAppointment {
  id: string;
  type: string;
  status: string;
  scheduledStart: Date;
  scheduledEnd: Date | null;
  location: string | null;
  notes: string | null;
  assigneeNames: string[];
}

/** Every non-cancelled appointment for one job, soonest first — for the
 * Job detail page's schedule section. */
export async function getJobAppointments(
  jobId: string,
): Promise<JobAppointment[]> {
  const rows = await db
    .select({
      id: appointments.id,
      type: appointments.type,
      status: appointments.status,
      scheduledStart: appointments.scheduledStart,
      scheduledEnd: appointments.scheduledEnd,
      location: appointments.location,
      notes: appointments.notes,
    })
    .from(appointments)
    .where(
      and(eq(appointments.jobId, jobId), ne(appointments.status, "cancelled")),
    )
    .orderBy(asc(appointments.scheduledStart));

  const assigneeNamesByAppointment = await getAssigneeNamesByAppointmentId(
    rows.map((r) => r.id),
  );

  return rows.map((r) => ({
    ...r,
    assigneeNames: assigneeNamesByAppointment.get(r.id) ?? [],
  }));
}

/**
 * Names of any of `userIds` who already have a status='scheduled'
 * appointment overlapping [scheduledStart, scheduledEnd) — a null
 * scheduledEnd (either on the candidate or an existing appointment) is
 * treated as a 1-hour block. Non-blocking: callers show this as a warning,
 * never as a hard rejection (section 41).
 */
export async function getAssigneeConflicts(params: {
  userIds: string[];
  scheduledStart: Date;
  scheduledEnd: Date | null;
  excludeAppointmentId?: string;
}): Promise<string[]> {
  const { userIds, scheduledStart, excludeAppointmentId } = params;
  if (userIds.length === 0) return [];

  const newEnd =
    params.scheduledEnd ?? new Date(scheduledStart.getTime() + 60 * 60 * 1000);

  const conditions = [
    inArray(appointmentAssignees.userId, userIds),
    eq(appointments.status, "scheduled"),
  ];
  if (excludeAppointmentId) {
    conditions.push(ne(appointments.id, excludeAppointmentId));
  }

  const rows = await db
    .select({
      userName: users.name,
      scheduledStart: appointments.scheduledStart,
      scheduledEnd: appointments.scheduledEnd,
    })
    .from(appointmentAssignees)
    .innerJoin(
      appointments,
      eq(appointmentAssignees.appointmentId, appointments.id),
    )
    .innerJoin(users, eq(appointmentAssignees.userId, users.id))
    .where(and(...conditions));

  const conflictNames = new Set<string>();
  for (const row of rows) {
    const existingEnd =
      row.scheduledEnd ??
      new Date(row.scheduledStart.getTime() + 60 * 60 * 1000);
    const overlaps =
      row.scheduledStart < newEnd && existingEnd > scheduledStart;
    if (overlaps) conflictNames.add(row.userName);
  }
  return Array.from(conflictNames);
}
