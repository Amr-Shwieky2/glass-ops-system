import type { Metadata } from "next";
import Link from "next/link";
import { Wrench } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getRepairsList, type RepairListRow } from "@/server/repairs/queries";
import { Forbidden } from "@/components/forbidden";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { StatusFilterSelect } from "./status-filter-select";

export const metadata: Metadata = { title: "الإصلاحات (تيكون) | نظام إدارة عمليات الزجاج" };

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

const STATUS_LABEL_AR: Record<RepairListRow["status"], string> = {
  open: "مفتوح",
  scheduled: "مجدول",
  in_progress: "قيد التنفيذ",
  resolved: "تم الحل",
};

const STATUS_VARIANT: Record<
  RepairListRow["status"],
  "destructive" | "warning" | "info" | "success"
> = {
  open: "destructive",
  scheduled: "warning",
  in_progress: "info",
  resolved: "success",
};

const VALID_STATUSES = new Set(["open", "scheduled", "in_progress", "resolved"]);

export default async function RepairsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_REPAIR)) {
    return <Forbidden />;
  }

  const status =
    params.status && VALID_STATUSES.has(params.status)
      ? (params.status as RepairListRow["status"])
      : undefined;

  const rows = await getRepairsList(status ? { status } : undefined);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">الإصلاحات (تيكون)</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "إصلاح" : "إصلاحات"}
        </p>
      </div>

      <form method="GET" className="flex flex-wrap gap-2">
        <StatusFilterSelect defaultValue={params.status} />
      </form>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="لا توجد إصلاحات"
              description={params.status ? "لا توجد نتائج مطابقة." : "لم يُسجَّل أي إصلاح بعد."}
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم المهمة</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>وصف المشكلة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>المسؤول</TableHead>
                  <TableHead>تاريخ الإبلاغ</TableHead>
                  <TableHead>الموعد المجدول</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/jobs/${row.jobId}`} className="hover:underline">
                        {row.jobNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{row.customerName}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {row.problemDescription}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status]}>
                        {STATUS_LABEL_AR[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.responsibleUserName ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateFmt.format(new Date(row.dateReported))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.scheduledDate ? dateFmt.format(new Date(row.scheduledDate)) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
