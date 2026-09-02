import { FileCheck2 } from "lucide-react";
import type { AuthedUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import {
  getIncomingChecks,
  getOutgoingChecks,
  type IncomingCheckRow,
  type OutgoingCheckRow,
} from "@/server/checks/queries";
import { formatILS } from "@/server/money";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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
import { AddIncomingCheckDialog } from "./add-incoming-check-dialog";
import { AddOutgoingCheckDialog } from "./add-outgoing-check-dialog";
import { IncomingCheckStatusControl, OutgoingCheckStatusControl } from "./check-status-control";

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

const INCOMING_STATUS_LABEL_AR: Record<IncomingCheckRow["status"], string> = {
  future: "مستقبلي",
  due_soon: "مستحق قريباً",
  deposited: "تم الإيداع",
  cleared: "تم التحصيل",
  failed: "فشل / ارتجع",
  cancelled: "ملغى",
};

const INCOMING_STATUS_VARIANT: Record<
  IncomingCheckRow["status"],
  "outline" | "warning" | "info" | "success" | "destructive"
> = {
  future: "outline",
  due_soon: "warning",
  deposited: "info",
  cleared: "success",
  failed: "destructive",
  cancelled: "outline",
};

const OUTGOING_STATUS_LABEL_AR: Record<OutgoingCheckRow["status"], string> = {
  pending: "قيد الإعداد",
  issued: "تم الإصدار",
  cleared: "تم الصرف",
  failed: "فشل / ارتجع",
  cancelled: "ملغى",
};

const OUTGOING_STATUS_VARIANT: Record<
  OutgoingCheckRow["status"],
  "outline" | "info" | "success" | "destructive"
> = {
  pending: "outline",
  issued: "info",
  cleared: "success",
  failed: "destructive",
  cancelled: "outline",
};

// A check no longer needs the "attention" highlight once it's reached one
// of these — the due-date urgency that isDueSoon flags is only meaningful
// while the check is still awaiting deposit/issuance.
const INCOMING_SETTLED: ReadonlySet<IncomingCheckRow["status"]> = new Set([
  "deposited",
  "cleared",
  "failed",
  "cancelled",
]);
const OUTGOING_SETTLED: ReadonlySet<OutgoingCheckRow["status"]> = new Set([
  "issued",
  "cleared",
  "failed",
  "cancelled",
]);

function formatDueDate(dueDate: string): string {
  return dateFmt.format(new Date(`${dueDate}T00:00:00`));
}

export async function ChecksSection({ user }: { user: AuthedUser }) {
  const canManageChecks = can(user, PERMISSIONS.MANAGE_CHECKS);

  const [incoming, outgoing] = await Promise.all([getIncomingChecks(), getOutgoingChecks()]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCheck2 className="size-5 text-muted-foreground" />
            الشيكات الواردة (من العملاء)
          </CardTitle>
          {canManageChecks && <AddIncomingCheckDialog />}
        </CardHeader>
        <CardContent className="p-0">
          {incoming.length === 0 ? (
            <EmptyState title="لا توجد شيكات واردة" className="border-0 p-6" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>العميل</TableHead>
                    <TableHead>المهمة</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>رقم الشيك / البنك</TableHead>
                    <TableHead>تاريخ الاستحقاق</TableHead>
                    <TableHead>الحالة</TableHead>
                    {canManageChecks && <TableHead>تحديث الحالة</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incoming.map((c) => {
                    const flagged = c.isDueSoon && !INCOMING_SETTLED.has(c.status);
                    return (
                      <TableRow key={c.id} className={flagged ? "bg-warning/5" : undefined}>
                        <TableCell className="font-medium text-foreground">{c.customerName}</TableCell>
                        <TableCell className="text-muted-foreground">{c.jobNumber ?? "—"}</TableCell>
                        <TableCell dir="ltr" className="text-end">{formatILS(c.amount)}</TableCell>
                        <TableCell dir="ltr" className="text-end text-muted-foreground">
                          {[c.checkNumber, c.bank].filter(Boolean).join(" · ") || "—"}
                        </TableCell>
                        <TableCell className={flagged ? "font-medium text-warning" : "text-muted-foreground"}>
                          {formatDueDate(c.dueDate)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={INCOMING_STATUS_VARIANT[c.status]}>
                            {INCOMING_STATUS_LABEL_AR[c.status]}
                          </Badge>
                        </TableCell>
                        {canManageChecks && (
                          <TableCell>
                            <IncomingCheckStatusControl checkId={c.id} />
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCheck2 className="size-5 text-muted-foreground" />
            الشيكات الصادرة (عن الشركة)
          </CardTitle>
          {canManageChecks && <AddOutgoingCheckDialog />}
        </CardHeader>
        <CardContent className="p-0">
          {outgoing.length === 0 ? (
            <EmptyState title="لا توجد شيكات صادرة" className="border-0 p-6" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المستفيد</TableHead>
                    <TableHead>المهمة</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>رقم الشيك</TableHead>
                    <TableHead>تاريخ الاستحقاق</TableHead>
                    <TableHead>الحالة</TableHead>
                    {canManageChecks && <TableHead>تحديث الحالة</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outgoing.map((c) => {
                    const flagged = c.isDueSoon && !OUTGOING_SETTLED.has(c.status);
                    return (
                      <TableRow key={c.id} className={flagged ? "bg-warning/5" : undefined}>
                        <TableCell className="font-medium text-foreground">{c.payeeName}</TableCell>
                        <TableCell className="text-muted-foreground">{c.jobNumber ?? "—"}</TableCell>
                        <TableCell dir="ltr" className="text-end">{formatILS(c.amount)}</TableCell>
                        <TableCell dir="ltr" className="text-end text-muted-foreground">
                          {c.checkNumber ?? "—"}
                        </TableCell>
                        <TableCell className={flagged ? "font-medium text-warning" : "text-muted-foreground"}>
                          {formatDueDate(c.dueDate)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={OUTGOING_STATUS_VARIANT[c.status]}>
                            {OUTGOING_STATUS_LABEL_AR[c.status]}
                          </Badge>
                        </TableCell>
                        {canManageChecks && (
                          <TableCell>
                            <OutgoingCheckStatusControl checkId={c.id} />
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
