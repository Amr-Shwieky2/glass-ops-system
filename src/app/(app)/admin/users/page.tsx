import type { Metadata } from "next";
import Link from "next/link";
import { Users as UsersIcon } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { listUsers } from "@/server/users/queries";
import { getVehiclesList } from "@/server/vehicles/queries";
import { formatILS } from "@/server/money";
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
import { CreateUserDialog } from "./create-user-dialog";

export const metadata: Metadata = { title: "المستخدمون | نظام إدارة عمليات الزجاج" };

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_USERS)) {
    return <Forbidden />;
  }

  const [rows, vehicles] = await Promise.all([listUsers(), getVehiclesList()]);
  const activeVehicles = vehicles
    .filter((v) => v.isActive)
    .map((v) => ({ id: v.id, name: v.name }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">المستخدمون والصلاحيات</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "مستخدم" : "مستخدمين"}
          </p>
        </div>
        <CreateUserDialog vehicles={activeVehicles} />
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="لا يوجد مستخدمون"
              description="لم يُنشأ أي مستخدم بعد."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الهاتف</TableHead>
                  <TableHead>البريد الإلكتروني</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>عدد الصلاحيات</TableHead>
                  <TableHead>الأجر اليومي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/admin/users/${row.id}`} className="hover:underline">
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {row.phone}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.email ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.status === "active" ? "success" : "warning"}>
                        {row.status === "active" ? "نشط" : "موقوف"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.permissionCount}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {row.dailyWageAmount ? formatILS(row.dailyWageAmount) : "—"}
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
