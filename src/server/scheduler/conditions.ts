import "server-only";
import { and, eq, gte, inArray, isNull, lt, lte, notExists, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  appointments,
  appointmentAssignees,
  quotes,
  jobs,
  jobStatuses,
  repairs,
  users,
  userPermissions,
  customerPayments,
  scheduledReminders,
} from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { notifyUsers } from "@/server/notifications";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";
import { sumMoney, subtractMoney, isPositive, type Money } from "@/server/money";
import { getIncomingChecks } from "@/server/checks/queries";
import { addCompanyDays } from "@/lib/company-day";

/**
 * The 7 time/condition-based notification triggers R1.39/R1.53 named as
 * blocked without a scheduler (measurement-in-1h, installation-tomorrow,
 * quote-awaiting-signature, ready-without-install, check-due,
 * repair-open-N-days, customer-owes) — the other 2 spec-named triggers
 * (factory price submitted, worker payment for approval) are already
 * event-driven from inside their own Server Actions and are untouched
 * here. Each function below: (1) finds entities currently matching its
 * condition, (2) atomically claims each one via `claim()` (see
 * scheduledReminders' own doc comment in schema/system.ts for why this is
 * race-safe and not just a SELECT-then-INSERT check), (3) notifies the
 * relevant users only for the ones it actually won the claim on. A
 * function here never throws past its own boundary — see runAll() below —
 * matching this codebase's existing "best-effort automation" convention
 * (src/server/quotes/actions.ts's runPostSignAutomation).
 */

async function claim(triggerType: string, relatedEntityId: string): Promise<boolean> {
  const [row] = await db
    .insert(scheduledReminders)
    .values({ triggerType, relatedEntityId })
    .onConflictDoNothing()
    .returning({ id: scheduledReminders.id });
  return !!row;
}

async function getUsersWithPermission(permissionKey: PermissionKey): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(userPermissions)
    .innerJoin(users, eq(userPermissions.userId, users.id))
    .where(
      and(
        eq(userPermissions.permissionKey, permissionKey),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------
// 1. Measurement appointment starting soon.
// ---------------------------------------------------------------------
export async function checkMeasurementReminders(): Promise<void> {
  const { measurementReminderMinutesBefore } = await getSetting("notification_thresholds");
  const now = new Date();
  const windowEnd = new Date(now.getTime() + measurementReminderMinutesBefore * 60_000);

  const rows = await db
    .select({ id: appointments.id, jobId: appointments.jobId, jobNumber: jobs.jobNumber })
    .from(appointments)
    .innerJoin(jobs, eq(appointments.jobId, jobs.id))
    .where(
      and(
        eq(appointments.type, "measurement"),
        eq(appointments.status, "scheduled"),
        gte(appointments.scheduledStart, now),
        lte(appointments.scheduledStart, windowEnd),
      ),
    );

  for (const row of rows) {
    // Claimed by the APPOINTMENT's own id, never the job's — a job can
    // have several measurement appointments over its life (rescheduled,
    // or a repeat visit), each one its own real-world moment that must be
    // reminded about independently.
    if (!(await claim("measurement_reminder", row.id))) continue;
    const assignees = await db
      .select({ userId: appointmentAssignees.userId })
      .from(appointmentAssignees)
      .where(eq(appointmentAssignees.appointmentId, row.id));
    if (assignees.length === 0) continue;
    await notifyUsers(
      assignees.map((a) => a.userId),
      {
        type: "measurement_reminder",
        title: `موعد قياس قريب — ${row.jobNumber}`,
        relatedEntityType: "job",
        relatedEntityId: row.jobId,
      },
    );
  }
}

// ---------------------------------------------------------------------
// 2. Installation appointment starting soon.
// ---------------------------------------------------------------------
export async function checkInstallationReminders(): Promise<void> {
  const { installationReminderHoursBefore } = await getSetting("notification_thresholds");
  const now = new Date();
  const windowEnd = new Date(now.getTime() + installationReminderHoursBefore * 60 * 60_000);

  const rows = await db
    .select({ id: appointments.id, jobId: appointments.jobId, jobNumber: jobs.jobNumber })
    .from(appointments)
    .innerJoin(jobs, eq(appointments.jobId, jobs.id))
    .where(
      and(
        eq(appointments.type, "installation"),
        eq(appointments.status, "scheduled"),
        gte(appointments.scheduledStart, now),
        lte(appointments.scheduledStart, windowEnd),
      ),
    );

  for (const row of rows) {
    if (!(await claim("installation_reminder", row.id))) continue;
    const assignees = await db
      .select({ userId: appointmentAssignees.userId })
      .from(appointmentAssignees)
      .where(eq(appointmentAssignees.appointmentId, row.id));
    if (assignees.length === 0) continue;
    await notifyUsers(
      assignees.map((a) => a.userId),
      {
        type: "installation_reminder",
        title: `موعد تركيب قريب — ${row.jobNumber}`,
        relatedEntityType: "job",
        relatedEntityId: row.jobId,
      },
    );
  }
}

// ---------------------------------------------------------------------
// 3. Quote sent but the customer still hasn't signed.
// ---------------------------------------------------------------------
// No admin-configurable threshold exists for this one (the notification_
// thresholds setting only has the 4 fields settings-defaults.ts declares —
// this trigger was never meant to have its own admin control, unlike the
// other 4 that read a real getSetting() value above/below). A fixed,
// reasonable delay, matching this codebase's existing convention of
// inline constants for things nobody asked to make admin-configurable
// (e.g. every checkRateLimit window/maxAttempts pair).
const QUOTE_AWAITING_SIGNATURE_HOURS = 48;

export async function checkQuoteAwaitingSignatureReminders(): Promise<void> {
  const cutoff = new Date(Date.now() - QUOTE_AWAITING_SIGNATURE_HOURS * 60 * 60_000);

  const rows = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      jobId: quotes.jobId,
      jobNumber: jobs.jobNumber,
      pricingResponsibleUserId: jobs.pricingResponsibleUserId,
    })
    .from(quotes)
    .innerJoin(jobs, eq(quotes.jobId, jobs.id))
    .where(and(eq(quotes.status, "sent"), lt(quotes.updatedAt, cutoff)));

  for (const row of rows) {
    if (!(await claim("quote_awaiting_signature_reminder", row.id))) continue;
    const recipientIds = row.pricingResponsibleUserId
      ? [row.pricingResponsibleUserId]
      : await getUsersWithPermission(PERMISSIONS.SEND_QUOTE);
    if (recipientIds.length === 0) continue;
    await notifyUsers(recipientIds, {
      type: "quote_awaiting_signature_reminder",
      title: `عرض السعر ${row.quoteNumber} لم يُوقَّع بعد — ${row.jobNumber}`,
      relatedEntityType: "job",
      relatedEntityId: row.jobId,
    });
  }
}

// ---------------------------------------------------------------------
// 4. Job ready from the factory with no installation appointment booked.
// Same condition dashboard/page.tsx's own inline "readyWithoutInstall"
// query already computes for its live dashboard tile — mirrored here as a
// one-shot NOTIFICATION rather than a live list, so staff are proactively
// pinged instead of only seeing it if they happen to open the dashboard.
// ---------------------------------------------------------------------
export async function checkReadyWithoutInstallReminders(): Promise<void> {
  const rows = await db
    .select({ id: jobs.id, jobNumber: jobs.jobNumber })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(
      and(
        isNull(jobs.deletedAt),
        eq(jobStatuses.key, "ready_from_factory"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(appointments)
            .where(
              and(
                eq(appointments.jobId, jobs.id),
                eq(appointments.type, "installation"),
              ),
            ),
        ),
      ),
    );

  const assignHolders = await getUsersWithPermission(PERMISSIONS.ASSIGN_INSTALLER);
  if (assignHolders.length === 0) return;

  for (const row of rows) {
    if (!(await claim("job_ready_without_install_reminder", row.id))) continue;
    await notifyUsers(assignHolders, {
      type: "job_ready_without_install_reminder",
      title: `المهمة ${row.jobNumber} جاهزة من المصنع بدون موعد تركيب`,
      relatedEntityType: "job",
      relatedEntityId: row.id,
    });
  }
}

// ---------------------------------------------------------------------
// 5. Incoming check due soon (section 39/R1.27) — reuses getIncomingChecks'
// own checkDueSoonDays-driven isDueSoon flag rather than re-deriving it.
// ---------------------------------------------------------------------
export async function checkIncomingCheckDueReminders(): Promise<void> {
  const checks = await getIncomingChecks();
  const dueSoon = checks.filter(
    (c) => c.isDueSoon && (c.status === "future" || c.status === "due_soon"),
  );
  if (dueSoon.length === 0) return;

  const manageChecksHolders = await getUsersWithPermission(PERMISSIONS.MANAGE_CHECKS);
  if (manageChecksHolders.length === 0) return;

  for (const check of dueSoon) {
    if (!(await claim("check_due_reminder", check.id))) continue;
    await notifyUsers(manageChecksHolders, {
      type: "check_due_reminder",
      title: `شيك مستحق قريباً — ${check.customerName}`,
      relatedEntityType: check.jobId ? "job" : undefined,
      relatedEntityId: check.jobId ?? undefined,
    });
  }
}

// ---------------------------------------------------------------------
// 6. Repair open for too many days (staleRepairDays).
// ---------------------------------------------------------------------
export async function checkStaleRepairReminders(): Promise<void> {
  const { staleRepairDays } = await getSetting("notification_thresholds");
  // Sprint 9: was computed via the server process's own local midnight
  // (setHours(0,0,0,0)), not the company's — the same class of bug
  // isCheckDueSoon had, just for a scheduled trigger instead of a display
  // value. A server not itself running in Asia/Jerusalem would mark a
  // repair stale up to a few hours early or late relative to the
  // business's actual day boundary.
  const cutoffDateString = addCompanyDays(-staleRepairDays);

  const rows = await db
    .select({
      id: repairs.id,
      jobId: repairs.jobId,
      jobNumber: jobs.jobNumber,
      responsibleUserId: repairs.responsibleUserId,
    })
    .from(repairs)
    .innerJoin(jobs, eq(repairs.jobId, jobs.id))
    .where(
      and(
        inArray(repairs.status, ["open", "scheduled", "in_progress"]),
        lte(repairs.dateReported, cutoffDateString),
      ),
    );

  for (const row of rows) {
    if (!(await claim("repair_stale_reminder", row.id))) continue;
    const recipientIds = row.responsibleUserId
      ? [row.responsibleUserId]
      : await getUsersWithPermission(PERMISSIONS.CREATE_REPAIR);
    if (recipientIds.length === 0) continue;
    await notifyUsers(recipientIds, {
      type: "repair_stale_reminder",
      title: `إصلاح مفتوح منذ أكثر من ${staleRepairDays} أيام — ${row.jobNumber}`,
      relatedEntityType: "job",
      relatedEntityId: row.jobId,
    });
  }
}

// ---------------------------------------------------------------------
// 7. Customer still owes money on a job that's been installed for a
// while. No admin-configurable threshold exists for this one either (see
// the matching comment on QUOTE_AWAITING_SIGNATURE_HOURS above) — a fixed
// week is a reasonable "the job is done, it's time to collect" point.
// jobs.updatedAt is used as a proxy for "installed since" (every status
// transition, including the one into 'installed', stamps it) rather than
// a dedicated installedAt column, which does not exist in the schema.
// ---------------------------------------------------------------------
const CUSTOMER_OWES_REMINDER_DAYS = 7;

export async function checkCustomerOwesReminders(): Promise<void> {
  const cutoff = new Date(Date.now() - CUSTOMER_OWES_REMINDER_DAYS * 24 * 60 * 60_000);

  const candidateJobs = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      salePriceTotal: jobs.salePriceTotal,
    })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(
      and(
        isNull(jobs.deletedAt),
        eq(jobStatuses.key, "installed"),
        lt(jobs.updatedAt, cutoff),
        sql`${jobs.salePriceTotal} is not null`,
      ),
    );
  if (candidateJobs.length === 0) return;

  const jobIds = candidateJobs.map((j) => j.id);
  const paymentRows = await db
    .select({ jobId: customerPayments.jobId, amount: customerPayments.amount })
    .from(customerPayments)
    .where(
      and(
        inArray(customerPayments.jobId, jobIds),
        eq(customerPayments.approvalStatus, "approved"),
      ),
    );
  const paidByJob = new Map<string, Money[]>();
  for (const p of paymentRows) {
    const arr = paidByJob.get(p.jobId) ?? [];
    arr.push(p.amount);
    paidByJob.set(p.jobId, arr);
  }

  const owingJobs = candidateJobs.filter((j) => {
    const paid = sumMoney(paidByJob.get(j.id) ?? []);
    const remaining = subtractMoney(j.salePriceTotal as Money, paid);
    return isPositive(remaining);
  });
  if (owingJobs.length === 0) return;

  const collectHolders = new Set([
    ...(await getUsersWithPermission(PERMISSIONS.COLLECT_PAYMENT)),
    ...(await getUsersWithPermission(PERMISSIONS.APPROVE_PAYMENT)),
  ]);
  if (collectHolders.size === 0) return;

  for (const job of owingJobs) {
    if (!(await claim("customer_owes_reminder", job.id))) continue;
    await notifyUsers(Array.from(collectHolders), {
      type: "customer_owes_reminder",
      title: `رصيد مستحق على المهمة ${job.jobNumber} منذ أكثر من ${CUSTOMER_OWES_REMINDER_DAYS} أيام`,
      relatedEntityType: "job",
      relatedEntityId: job.id,
    });
  }
}

/**
 * Runs every scheduled condition once. Each condition is independently
 * try/caught — one failing check must never block the other 6 (mirrors
 * runPostSignAutomation's own per-step isolation). Returns which
 * conditions failed, for the caller (the internal API route) to log/report
 * without ever throwing itself.
 */
export async function runAllScheduledChecks(): Promise<{ name: string; error: string }[]> {
  const checks: [string, () => Promise<void>][] = [
    ["measurement_reminders", checkMeasurementReminders],
    ["installation_reminders", checkInstallationReminders],
    ["quote_awaiting_signature_reminders", checkQuoteAwaitingSignatureReminders],
    ["ready_without_install_reminders", checkReadyWithoutInstallReminders],
    ["incoming_check_due_reminders", checkIncomingCheckDueReminders],
    ["stale_repair_reminders", checkStaleRepairReminders],
    ["customer_owes_reminders", checkCustomerOwesReminders],
  ];

  const failures: { name: string; error: string }[] = [];
  for (const [name, fn] of checks) {
    try {
      await fn();
    } catch (err) {
      failures.push({ name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return failures;
}
