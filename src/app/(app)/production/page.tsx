import type { Metadata } from "next";
import Link from "next/link";
import { Search, Factory } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { listProductionRequests, isFactoryStatus } from "@/server/production/queries";
import { formatILS } from "@/server/money";
import { PRODUCTION_STATUS_LABEL, productionStatusVariant } from "@/lib/production-status-style";
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

export const metadata: Metadata = { title: "الإنتاج والمصنع | نظام إدارة عمليات الزجاج" };

const PAGE_SIZE = 25;

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (
    !canAny(user, [PERMISSIONS.CREATE_PRODUCTION_ORDER, PERMISSIONS.APPROVE_FACTORY_PRICE])
  ) {
    return <Forbidden />;
  }
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status && isFactoryStatus(params.status) ? params.status : undefined;

  const { rows, total } = await listProductionRequests({
    search: params.q,
    status,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">الإنتاج والمصنع</h1>
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? "طلب إنتاج" : "طلبات إنتاج"}
        </p>
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
        <StatusFilterSelect defaultValue={params.status} />
        <Button type="submit" variant="secondary">
          بحث
        </Button>
      </form>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={Factory}
              title="لا توجد طلبات إنتاج"
              description={
                params.q || params.status
                  ? "لا توجد نتائج مطابقة."
                  : "لم تُرسل أي مهمة إلى المصنع بعد."
              }
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم المهمة</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>آخر سعر مُرسل</TableHead>
                  <TableHead>جاهزية متوقعة (تقديرنا)</TableHead>
                  <TableHead>تاريخ الإرسال</TableHead>
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
                    <TableCell>
                      <Badge variant={productionStatusVariant(row.status)}>
                        {PRODUCTION_STATUS_LABEL[row.status] ?? row.status}
                      </Badge>
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {row.latestSubmittedPrice ? formatILS(row.latestSubmittedPrice) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.estimatedReadyDate
                        ? dateFmt.format(new Date(row.estimatedReadyDate))
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateFmt.format(row.createdAt)}
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
                href={`/production?${new URLSearchParams({
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
