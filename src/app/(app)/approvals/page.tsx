import type { Metadata } from "next";
import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import {
  getPendingApprovalRequests,
  type ApprovalEntityType,
} from "@/server/approvals/queries";
import { COMPANY_TIMEZONE } from "@/lib/company-day";
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

export const metadata: Metadata = { title: "طلبات الموافقة | نظام إدارة عمليات الزجاج" };

const ENTITY_TYPE_LABEL_AR: Record<ApprovalEntityType, string> = {
  customer_payment: "دفعة عميل",
  technician_ledger_entry: "قيد حساب فني",
  factory_submission: "سعر مصنع",
  job_cost: "تكلفة مهمة",
  cash_expense_report: "مصروف ميداني",
};

const dateTimeFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn",
  timeZone: COMPANY_TIMEZONE,
});

/**
 * Unified approval queue — a READ-ONLY index over approval_requests
 * (src/server/approvals/queries.ts). Deliberately has no approve/reject
 * controls of its own: each row's "عرض" link opens the entity's real page,
 * where the actual decision controls from Phases 7-9 already live.
 */
export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.APPROVE_REQUESTS)) {
    return <Forbidden />;
  }

  const rows = await getPendingApprovalRequests();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">طلبات الموافقة</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "طلب قيد الانتظار" : "طلبات قيد الانتظار"}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={CheckSquare}
              title="لا توجد طلبات موافقة قيد الانتظار"
              description="ستظهر هنا الطلبات الجديدة فور ورودها."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>مقدَّم من</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>التفاصيل</TableHead>
                  <TableHead>المهمة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dateTimeFmt.format(row.requestedAt)}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {row.requestedByName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {ENTITY_TYPE_LABEL_AR[row.entityType] ?? row.entityType}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md text-muted-foreground">
                      {row.summary}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.relatedJobNumber ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={row.viewHref}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        عرض
                      </Link>
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
