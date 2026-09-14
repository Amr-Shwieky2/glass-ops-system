import type { Metadata } from "next";
import Link from "next/link";
import { Search, Briefcase, Plus } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can, canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { listJobs, getAllJobStatuses } from "@/server/jobs/queries";
import { formatILS } from "@/server/money";
import { jobStatusVariant } from "@/lib/job-status-style";
import { Forbidden } from "@/components/forbidden";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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

export const metadata: Metadata = { title: "المهام | نظام إدارة عمليات الزجاج" };

const PAGE_SIZE = 25;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!canAny(user, [PERMISSIONS.VIEW_ALL_JOBS, PERMISSIONS.VIEW_ASSIGNED_JOBS])) {
    return <Forbidden />;
  }
  const canViewAll = can(user, PERMISSIONS.VIEW_ALL_JOBS);
  const canViewSalePrice = can(user, PERMISSIONS.VIEW_SALE_PRICE);
  const page = Math.max(1, Number(params.page) || 1);

  const [{ rows, total }, statuses] = await Promise.all([
    listJobs({
      search: params.q,
      statusKey: params.status,
      restrictToUserId: canViewAll ? undefined : user!.id,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getAllJobStatuses(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">المهام</h1>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "مهمة" : "مهام"}
            {!canViewAll && " (المهام التي لك علاقة بها)"}
          </p>
        </div>
        <Button asChild>
          <Link href="/jobs/new">
            <Plus className="size-4" />
            مهمة جديدة
          </Link>
        </Button>
      </div>

      <form method="GET" className="flex flex-wrap gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder="ابحث برقم المهمة أو اسم العميل..."
            className="ps-9"
          />
        </div>
        <StatusFilterSelect statuses={statuses} defaultValue={params.status} />
        <Button type="submit" variant="secondary">
          بحث
        </Button>
      </form>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="لا توجد مهام"
              description={params.q || params.status ? "لا توجد نتائج مطابقة." : "لم تُنشأ أي مهمة بعد."}
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم المهمة</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الحالة</TableHead>
                  {canViewSalePrice && <TableHead>قيمة البيع</TableHead>}
                  <TableHead>تاريخ الإنشاء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/jobs/${job.id}`} className="hover:underline">
                        {job.jobNumber}
                      </Link>
                      {job.title && (
                        <p className="text-xs font-normal text-muted-foreground">
                          {job.title}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/customers/${job.customerId}`}
                        className="hover:underline"
                      >
                        {job.customerName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={jobStatusVariant(job.statusKey)}>
                        {job.statusLabelAr}
                      </Badge>
                    </TableCell>
                    {canViewSalePrice && (
                      <TableCell dir="ltr" className="text-end text-muted-foreground">
                        {job.salePriceTotal ? formatILS(job.salePriceTotal) : "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-muted-foreground">
                      {new Intl.DateTimeFormat("ar", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        numberingSystem: "latn",
                      }).format(job.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Button key={p} asChild variant={p === page ? "default" : "outline"} size="sm">
              <Link
                href={`/jobs?${new URLSearchParams({
                  ...(params.q ? { q: params.q } : {}),
                  ...(params.status ? { status: params.status } : {}),
                  page: String(p),
                }).toString()}`}
              >
                {p}
              </Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
