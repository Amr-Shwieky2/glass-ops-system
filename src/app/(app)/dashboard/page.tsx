import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { eq, and, isNull, count, notExists, exists, sql, gte, lt, ne, asc } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs, jobStatuses, customers, appointments, appointmentAssignees } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can, canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { involvementFilter } from "@/server/jobs/queries";
import { getTodayRangeUtc } from "@/lib/company-day";
import { getOpenRepairsCount, getOpenRepairs } from "@/server/repairs/queries";
import {
  PREVIEW_LIMIT,
  getJobsWaitingForPricing,
  getJobsWaitingForQuoteSignature,
  getFactoryPricesWaitingApproval,
  getCustomersWithOutstandingBalance,
  getChecksDueSoon,
  getPendingApprovalsCount,
} from "@/server/dashboard/needs-attention";
import { formatILS } from "@/server/money";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Forbidden } from "@/components/forbidden";
import {
  Users,
  Briefcase,
  Hourglass,
  ArrowLeft,
  Ruler,
  Wrench,
  CalendarClock,
  PackageCheck,
  DollarSign,
  FileSignature,
  Factory,
  Banknote,
  FileCheck2,
  ClipboardCheck,
} from "lucide-react";

export const metadata: Metadata = {
  title: "لوحة التحكم | نظام إدارة عمليات الزجاج",
};

const timeFmt = new Intl.DateTimeFormat("ar", {
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn",
});

const dueDateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

function formatDueDate(dueDate: string): string {
  return dueDateFmt.format(new Date(`${dueDate}T00:00:00`));
}

const APPOINTMENT_TYPE_LABEL_AR: Record<string, string> = {
  measurement: "قياس",
  installation: "تركيب",
  repair: "إصلاح",
  customer_meeting: "لقاء عميل",
  other: "أخرى",
};

async function getDashboardStats(
  restrictToUserId: string | undefined,
  canSeeChecks: boolean,
  canSeeApprovals: boolean,
  canSeeFactoryPrices: boolean,
  canSeeCustomerBalances: boolean,
) {
  const { start: todayStart, end: todayEnd } = getTodayRangeUtc();

  const [
    [{ value: customerCount }],
    [{ value: activeJobsCount }],
    [{ value: awaitingApprovalCount }],
    readyWithoutInstall,
    todayAppointmentRows,
    openRepairsCount,
    openRepairs,
    waitingForPricing,
    waitingForQuoteSignature,
    factoryPricesWaitingApproval,
    customersWithOutstandingBalance,
    checksDueSoon,
    pendingApprovalsCount,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(customers)
      .where(isNull(customers.deletedAt)),
    db
      .select({ value: count() })
      .from(jobs)
      .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
      .where(and(isNull(jobs.deletedAt), eq(jobStatuses.isTerminal, false))),
    db
      .select({ value: count() })
      .from(jobs)
      .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
      .where(
        and(
          isNull(jobs.deletedAt),
          eq(jobStatuses.key, "waiting_for_customer_approval"),
        ),
      ),
    db
      .select({
        id: jobs.id,
        jobNumber: jobs.jobNumber,
        customerName: customers.name,
      })
      .from(jobs)
      .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
      .innerJoin(customers, eq(jobs.customerId, customers.id))
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
          ...(restrictToUserId ? [involvementFilter(restrictToUserId)!] : []),
        ),
      ),
    db
      .select({
        id: appointments.id,
        type: appointments.type,
        scheduledStart: appointments.scheduledStart,
        jobId: appointments.jobId,
        jobNumber: jobs.jobNumber,
        customerName: customers.name,
      })
      .from(appointments)
      .innerJoin(jobs, eq(appointments.jobId, jobs.id))
      .innerJoin(customers, eq(jobs.customerId, customers.id))
      .where(
        and(
          gte(appointments.scheduledStart, todayStart),
          lt(appointments.scheduledStart, todayEnd),
          ne(appointments.status, "cancelled"),
          ...(restrictToUserId
            ? [
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
              ]
            : []),
        ),
      )
      .orderBy(asc(appointments.scheduledStart)),
    getOpenRepairsCount(restrictToUserId),
    getOpenRepairs(restrictToUserId),
    getJobsWaitingForPricing(restrictToUserId),
    getJobsWaitingForQuoteSignature(restrictToUserId),
    canSeeFactoryPrices
      ? getFactoryPricesWaitingApproval(restrictToUserId)
      : Promise.resolve({ items: [], total: 0 }),
    canSeeCustomerBalances
      ? getCustomersWithOutstandingBalance(restrictToUserId)
      : Promise.resolve({ items: [], total: 0 }),
    canSeeChecks ? getChecksDueSoon() : Promise.resolve({ items: [], total: 0 }),
    canSeeApprovals ? getPendingApprovalsCount(restrictToUserId) : Promise.resolve(0),
  ]);

  return {
    customerCount,
    activeJobsCount,
    awaitingApprovalCount,
    readyWithoutInstall,
    measurementsToday: todayAppointmentRows.filter((a) => a.type === "measurement").length,
    installationsToday: todayAppointmentRows.filter((a) => a.type === "installation").length,
    repairsToday: todayAppointmentRows.filter((a) => a.type === "repair").length,
    todayAppointments: todayAppointmentRows,
    openRepairsCount,
    openRepairs,
    waitingForPricing,
    waitingForQuoteSignature,
    factoryPricesWaitingApproval,
    customersWithOutstandingBalance,
    checksDueSoon,
    pendingApprovalsCount,
  };
}

interface AttentionCategory {
  id: string;
  icon: LucideIcon;
  label: string;
  total: number;
  preview?: string[];
  href?: string;
}

/**
 * One compact row inside the "تحتاج انتباه" card: icon + label + count
 * badge, a "عرض الكل" link when the category has a destination screen, and
 * (only when the full set is small enough to be useful — PREVIEW_LIMIT
 * items or fewer) a one-line preview of the items themselves.
 */
function AttentionRow({ icon: Icon, label, total, preview, href }: AttentionCategory) {
  const showPreview = preview && preview.length > 0 && preview.length === total;
  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-warning" />
          <span className="truncate font-medium text-foreground">{label}</span>
          <Badge variant="warning">{total}</Badge>
        </div>
        {href && (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            عرض الكل
            <ArrowLeft className="size-4" />
          </Link>
        )}
      </div>
      {showPreview && (
        <p className="mt-1 mr-6 truncate text-xs text-muted-foreground">
          {preview.join("  ·  ")}
        </p>
      )}
    </li>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!canAny(user, [PERMISSIONS.VIEW_ALL_JOBS, PERMISSIONS.VIEW_ASSIGNED_JOBS])) {
    return <Forbidden />;
  }
  const canViewAll = can(user, PERMISSIONS.VIEW_ALL_JOBS);
  const canSeeChecks = can(user, PERMISSIONS.MANAGE_CHECKS);
  const canSeeApprovals = can(user, PERMISSIONS.APPROVE_REQUESTS);
  const canSeeFactoryPrices = canAny(user, [
    PERMISSIONS.CREATE_PRODUCTION_ORDER,
    PERMISSIONS.APPROVE_FACTORY_PRICE,
  ]);
  const canSeeCustomerBalances = canAny(user, [
    PERMISSIONS.COLLECT_PAYMENT,
    PERMISSIONS.APPROVE_PAYMENT,
    PERMISSIONS.VIEW_JOB_COSTS,
  ]);
  const restrictToUserId = canViewAll ? undefined : user!.id;
  const stats = await getDashboardStats(
    restrictToUserId,
    canSeeChecks,
    canSeeApprovals,
    canSeeFactoryPrices,
    canSeeCustomerBalances,
  );

  const readyWithoutInstallPreview = stats.readyWithoutInstall
    .slice(0, PREVIEW_LIMIT)
    .map((j) => `${j.jobNumber} — ${j.customerName}`);
  const openRepairsPreview = stats.openRepairs
    .slice(0, PREVIEW_LIMIT)
    .map((r) => `${r.jobNumber} — ${r.customerName}`);

  const categories: AttentionCategory[] = [];

  if (stats.readyWithoutInstall.length > 0) {
    categories.push({
      id: "ready-without-install",
      icon: PackageCheck,
      label: "مهام جاهزة من المصنع بدون موعد تركيب",
      total: stats.readyWithoutInstall.length,
      preview: readyWithoutInstallPreview,
      href: "/jobs?status=ready_from_factory",
    });
  }

  if (stats.openRepairsCount > 0) {
    categories.push({
      id: "open-repairs",
      icon: Wrench,
      label: "إصلاحات مفتوحة",
      total: stats.openRepairsCount,
      preview: openRepairsPreview,
      href: "/repairs?status=open",
    });
  }

  if (stats.waitingForPricing.total > 0) {
    categories.push({
      id: "waiting-for-pricing",
      icon: DollarSign,
      label: "بانتظار التسعير",
      total: stats.waitingForPricing.total,
      preview: stats.waitingForPricing.items.map(
        (j) => `${j.jobNumber} — ${j.customerName}`,
      ),
      href: "/jobs?status=waiting_for_pricing",
    });
  }

  if (stats.waitingForQuoteSignature.total > 0) {
    categories.push({
      id: "waiting-for-quote-signature",
      icon: FileSignature,
      label: "بانتظار توقيع عرض السعر",
      total: stats.waitingForQuoteSignature.total,
      preview: stats.waitingForQuoteSignature.items.map(
        (j) => `${j.jobNumber} — ${j.customerName}`,
      ),
      href: "/jobs?status=quote_sent",
    });
  }

  if (canSeeFactoryPrices && stats.factoryPricesWaitingApproval.total > 0) {
    categories.push({
      id: "factory-price-waiting-approval",
      icon: Factory,
      label: "أسعار مصنع بانتظار الاعتماد",
      total: stats.factoryPricesWaitingApproval.total,
      preview: stats.factoryPricesWaitingApproval.items.map((r) =>
        r.latestSubmittedPrice
          ? `${r.jobNumber} — ${r.customerName} (${formatILS(r.latestSubmittedPrice)})`
          : `${r.jobNumber} — ${r.customerName}`,
      ),
      href: "/production?status=submitted",
    });
  }

  if (canSeeCustomerBalances && stats.customersWithOutstandingBalance.total > 0) {
    categories.push({
      id: "customers-with-balance",
      icon: Banknote,
      label: "أرصدة عملاء مستحقة",
      total: stats.customersWithOutstandingBalance.total,
      preview: stats.customersWithOutstandingBalance.items.map(
        (c) => `${c.customerName} — ${formatILS(c.remaining)}`,
      ),
    });
  }

  if (canSeeChecks && stats.checksDueSoon.total > 0) {
    categories.push({
      id: "checks-due-soon",
      icon: FileCheck2,
      label: "شيكات مستحقة قريباً",
      total: stats.checksDueSoon.total,
      preview: stats.checksDueSoon.items.map(
        (c) => `${c.customerName} — ${formatILS(c.amount)} — ${formatDueDate(c.dueDate)}`,
      ),
      href: "/finance",
    });
  }

  if (canSeeApprovals && stats.pendingApprovalsCount > 0) {
    categories.push({
      id: "pending-approvals",
      icon: ClipboardCheck,
      label: "طلبات بانتظار الموافقة",
      total: stats.pendingApprovalsCount,
      href: "/approvals",
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          مرحباً، {user?.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          نظرة سريعة على عمليات الشركة اليوم
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              إجمالي العملاء
            </CardTitle>
            <Users className="size-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">
              {stats.customerCount}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              المهام النشطة
            </CardTitle>
            <Briefcase className="size-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">
              {stats.activeJobsCount}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              بانتظار موافقة العميل
            </CardTitle>
            <Hourglass className="size-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">
              {stats.awaitingApprovalCount}
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold text-foreground">اليوم</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                قياسات اليوم
              </CardTitle>
              <Ruler className="size-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-foreground">
                {stats.measurementsToday}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                تركيبات اليوم
              </CardTitle>
              <CalendarClock className="size-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-foreground">
                {stats.installationsToday}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                إصلاحات اليوم
              </CardTitle>
              <Wrench className="size-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-foreground">
                {stats.repairsToday}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-5 text-muted-foreground" />
            جدول اليوم
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.todayAppointments.length === 0 ? (
            <EmptyState title="لا توجد مواعيد اليوم" />
          ) : (
            <ul className="divide-y">
              {stats.todayAppointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span dir="ltr" className="text-sm font-medium text-foreground">
                      {timeFmt.format(a.scheduledStart)}
                    </span>
                    <Badge variant="outline">
                      {APPOINTMENT_TYPE_LABEL_AR[a.type] ?? a.type}
                    </Badge>
                    <div>
                      <p className="font-medium text-foreground">{a.jobNumber}</p>
                      <p className="text-sm text-muted-foreground">{a.customerName}</p>
                    </div>
                  </div>
                  <Link
                    href={`/jobs/${a.jobId}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    عرض المهمة
                    <ArrowLeft className="size-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">تحتاج انتباه</CardTitle>
          <CardDescription>
            ملخص مختصر لكل ما يحتاج متابعة أو قراراً — مهام، أسعار مصنع، أرصدة، شيكات، وموافقات.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <EmptyState title="لا يوجد ما يحتاج انتباه حالياً" />
          ) : (
            <ul className="divide-y">
              {categories.map((c) => (
                <AttentionRow key={c.id} {...c} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
