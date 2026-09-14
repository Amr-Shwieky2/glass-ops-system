import type { Metadata } from "next";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { listCustomers } from "@/server/customers/queries";
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
import { AddCustomerButton } from "./add-customer-button";

export const metadata: Metadata = { title: "العملاء | نظام إدارة عمليات الزجاج" };

const PAGE_SIZE = 25;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.VIEW_CUSTOMERS)) {
    return <Forbidden />;
  }
  const canCreate = can(user, PERMISSIONS.CREATE_CUSTOMER);
  // A restricted viewer (no VIEW_ALL_JOBS, no CREATE_CUSTOMER) sees only
  // customers they have an actual job relationship with — see
  // listCustomers' own comment. CREATE_CUSTOMER holders are exempted: a
  // brand-new customer with no job yet would otherwise be invisible even
  // to the person who just created them, and finding/avoiding duplicate
  // customers is inherent to that permission's job.
  const canBrowseAll = can(user, PERMISSIONS.VIEW_ALL_JOBS) || canCreate;
  const page = Math.max(1, Number(params.page) || 1);
  const { rows, total } = await listCustomers({
    search: params.q,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    restrictToUserId: canBrowseAll ? undefined : user!.id,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">العملاء</h1>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "عميل" : "عملاء"} مسجّلون
          </p>
        </div>
        {canCreate && <AddCustomerButton />}
      </div>

      <form method="GET" className="flex max-w-md gap-2">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder="ابحث بالاسم أو رقم الهاتف..."
            className="ps-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          بحث
        </Button>
      </form>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="لا يوجد عملاء"
              description={
                params.q
                  ? "لا توجد نتائج مطابقة لبحثك."
                  : "لم تتم إضافة أي عميل بعد."
              }
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>رقم الهاتف</TableHead>
                  <TableHead>العنوان</TableHead>
                  <TableHead>عدد المهام</TableHead>
                  <TableHead>تاريخ الإضافة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer">
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/customers/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell dir="ltr" className="text-end">
                      {c.phone}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {c.address ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{c.jobsCount}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Intl.DateTimeFormat("ar", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        numberingSystem: "latn",
                      }).format(c.createdAt)}
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
            <Button
              key={p}
              asChild
              variant={p === page ? "default" : "outline"}
              size="sm"
            >
              <Link
                href={`/customers?${new URLSearchParams({
                  ...(params.q ? { q: params.q } : {}),
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
