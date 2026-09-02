import type { Metadata } from "next";
import Link from "next/link";
import { eq, and, isNull, count, notExists, sql, gte, lt, ne, asc } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs, jobStatuses, customers, appointments } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { getTodayRangeUtc } from "@/lib/company-day";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Users, Briefcase, Hourglass, Factory, ArrowLeft, Ruler, Wrench, CalendarClock } from "lucide-react";

export const metadata: Metadata = {
  title: "لوحة التحكم | نظام إدارة عمليات الزجاج",
};

const timeFmt = new Intl.DateTimeFormat("ar", {
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn",
});

const APPOINTMENT_TYPE_LABEL_AR: Record<string, string> = {
  measurement: "قياس",
  installation: "تركيب",
  repair: "إصلاح",
  customer_meeting: "لقاء عميل",
  other: "أخرى",
};

async function getDashboardStats() {
  const { start: todayStart, end: todayEnd } = getTodayRangeUtc();

  const [
    [{ value: customerCount }],
    [{ value: activeJobsCount }],
    [{ value: awaitingApprovalCount }],
    readyWithoutInstall,
    todayAppointmentRows,
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
          ),
        )
        .orderBy(asc(appointments.scheduledStart)),
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
  };
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const stats = await getDashboardStats();

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Factory className="size-5 text-warning" />
            مهام جاهزة من المصنع بدون موعد تركيب
          </CardTitle>
          <CardDescription>
            هذه المهام وصلت من المصنع ولم يُحدَّد لها موعد تركيب بعد.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stats.readyWithoutInstall.length === 0 ? (
            <EmptyState title="لا توجد مهام بحاجة لجدولة تركيب حالياً" />
          ) : (
            <ul className="divide-y">
              {stats.readyWithoutInstall.map((job) => (
                <li key={job.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {job.jobNumber}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {job.customerName}
                    </p>
                  </div>
                  <Link
                    href={`/jobs/${job.id}`}
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
    </div>
  );
}
