import type { Metadata } from "next";
import Link from "next/link";
import { eq, and, isNull, count, notExists, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs, jobStatuses, customers, appointments } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Users, Briefcase, Hourglass, Factory, ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "لوحة التحكم | نظام إدارة عمليات الزجاج",
};

async function getDashboardStats() {
  const [[{ value: customerCount }], [{ value: activeJobsCount }], [{ value: awaitingApprovalCount }], readyWithoutInstall] =
    await Promise.all([
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
    ]);

  return {
    customerCount,
    activeJobsCount,
    awaitingApprovalCount,
    readyWithoutInstall,
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
    </div>
  );
}
