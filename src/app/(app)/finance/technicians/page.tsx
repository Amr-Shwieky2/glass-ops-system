import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getAllTechniciansBalanceSummary } from "@/server/compensation/queries";
import { formatILS } from "@/server/money";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "حسابات الفنيين | نظام إدارة عمليات الزجاج" };

export default async function TechniciansRosterPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // A technician without the broad permission still always gets to see
  // their own numbers — send them straight to their own ledger instead of
  // a Forbidden page.
  if (!can(user, PERMISSIONS.VIEW_TECHNICIAN_BALANCES)) {
    redirect(`/finance/technicians/${user.id}`);
  }

  const rows = await getAllTechniciansBalanceSummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">حسابات الفنيين</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "فني" : "فنيين"}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="لا يوجد فنيون بعد"
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الرصيد المستحق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/finance/technicians/${row.userId}`} className="hover:underline">
                        {row.userName}
                      </Link>
                    </TableCell>
                    <TableCell dir="ltr" className="text-end font-medium">
                      {formatILS(row.balance)}
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
