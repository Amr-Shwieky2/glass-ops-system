import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getAuditLog } from "@/server/audit/queries";
import { listUsers } from "@/server/users/queries";
import { Forbidden } from "@/components/forbidden";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { EntityTypeFilterSelect, UserFilterSelect } from "./audit-filters";

export const metadata: Metadata = { title: "سجل التدقيق | نظام إدارة عمليات الزجاج" };

const PAGE_SIZE = 50;

const dateTimeFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn",
});

/** entityType -> a route this app actually has, or undefined for "no link,
 *  just show the text" — deliberately not guessing routes that don't
 *  exist for every other entity type. */
function entityHref(entityType: string, entityId: string): string | undefined {
  if (entityType === "job") return `/jobs/${entityId}`;
  return undefined;
}

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    entityType?: string;
    userId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const viewer = await getCurrentUser();
  if (!can(viewer, PERMISSIONS.VIEW_AUDIT_LOG)) {
    return <Forbidden />;
  }

  const page = Math.max(1, Number(params.page) || 1);
  const dateFrom = params.dateFrom ? new Date(`${params.dateFrom}T00:00:00`) : undefined;
  const dateTo = params.dateTo ? new Date(`${params.dateTo}T23:59:59.999`) : undefined;

  const [{ rows, total }, users] = await Promise.all([
    getAuditLog(
      {
        entityType: params.entityType,
        userId: params.userId,
        dateFrom: dateFrom && !Number.isNaN(dateFrom.getTime()) ? dateFrom : undefined,
        dateTo: dateTo && !Number.isNaN(dateTo.getTime()) ? dateTo : undefined,
      },
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE,
    ),
    listUsers(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const userOptions = users.map((u) => ({ id: u.id, name: u.name }));

  const currentQuery = {
    ...(params.entityType ? { entityType: params.entityType } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
    ...(params.dateTo ? { dateTo: params.dateTo } : {}),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">سجل التدقيق</h1>
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? "حدث" : "أحداث"}
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-2">
        <EntityTypeFilterSelect defaultValue={params.entityType} />
        <UserFilterSelect users={userOptions} defaultValue={params.userId} />
        <div className="space-y-1">
          <Label htmlFor="dateFrom" className="text-xs text-muted-foreground">
            من تاريخ
          </Label>
          <Input
            id="dateFrom"
            name="dateFrom"
            type="date"
            dir="ltr"
            defaultValue={params.dateFrom}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dateTo" className="text-xs text-muted-foreground">
            إلى تاريخ
          </Label>
          <Input
            id="dateTo"
            name="dateTo"
            type="date"
            dir="ltr"
            defaultValue={params.dateTo}
          />
        </div>
        {params.entityType && (
          <input type="hidden" name="entityType" value={params.entityType} />
        )}
        {params.userId && <input type="hidden" name="userId" value={params.userId} />}
        <Button type="submit" variant="secondary">
          بحث
        </Button>
      </form>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="لا توجد أحداث"
              description="لا توجد نتائج مطابقة لعوامل التصفية."
              className="border-0"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ والوقت</TableHead>
                    <TableHead>المستخدم</TableHead>
                    <TableHead>الإجراء</TableHead>
                    <TableHead>الكيان</TableHead>
                    <TableHead>التفاصيل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const href = entityHref(row.entityType, row.entityId);
                    const hasDiff = row.oldValue != null || row.newValue != null;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dateTimeFmt.format(row.createdAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {row.userName ?? "النظام"}
                        </TableCell>
                        <TableCell dir="ltr" className="text-end font-mono text-xs">
                          {row.action}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {href ? (
                            <Link href={href} className="hover:underline">
                              {row.entityType} / {row.entityId.slice(0, 8)}
                            </Link>
                          ) : (
                            <span dir="ltr" className="text-muted-foreground">
                              {row.entityType} / {row.entityId.slice(0, 8)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[16rem] max-w-[28rem]">
                          {hasDiff ? (
                            <details>
                              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                                عرض التغييرات
                              </summary>
                              <pre
                                dir="ltr"
                                className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-start font-mono text-[11px] leading-relaxed"
                              >
                                {JSON.stringify(
                                  { old: row.oldValue, new: row.newValue },
                                  null,
                                  2,
                                )}
                              </pre>
                            </details>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/admin/audit-log?${new URLSearchParams({
                  ...currentQuery,
                  page: String(page - 1),
                }).toString()}`}
              >
                السابق
              </Link>
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            صفحة {page} من {totalPages}
          </span>
          {page < totalPages && (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/admin/audit-log?${new URLSearchParams({
                  ...currentQuery,
                  page: String(page + 1),
                }).toString()}`}
              >
                التالي
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
