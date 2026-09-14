import Link from "next/link";
import { Wallet, Building2, User as UserIcon } from "lucide-react";
import type { AuthedUser } from "@/server/auth/session";
import { can, isSuperAdmin } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getCashAccountBalances } from "@/server/finance/queries";
import { getPendingCashTransfers } from "./queries";
import { formatILS } from "@/server/money";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HandOverCashDialog } from "./hand-over-cash-dialog";
import { ConfirmTransferButton } from "./confirm-transfer-button";

const dateTimeFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn",
});

export async function CashSection({ user }: { user: AuthedUser }) {
  const canViewAllBalances = can(user, PERMISSIONS.VIEW_TECHNICIAN_BALANCES);
  const canManageTechPayments = can(user, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS);

  const [allBalances, pendingTransfers] = await Promise.all([
    getCashAccountBalances(),
    getPendingCashTransfers(),
  ]);

  // A technician should always know their own numbers even without the
  // broad VIEW_TECHNICIAN_BALANCES permission — filter the list to their
  // own row rather than hiding the whole section from them.
  const visibleBalances = canViewAllBalances
    ? allBalances
    : allBalances.filter((b) => b.ownerUserId === user.id);

  // Managers see every pending handover (they're the ones confirming it);
  // everyone else only sees the ones they themselves initiated.
  const visibleTransfers = canManageTechPayments
    ? pendingTransfers
    : pendingTransfers.filter((t) => t.fromUserId === user.id);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-5 text-muted-foreground" />
            الصناديق النقدية
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {visibleBalances.length === 0 ? (
            <EmptyState title="لا توجد صناديق نقدية بعد" className="border-0 p-6" />
          ) : (
            <ul className="divide-y">
              {visibleBalances.map((b) => (
                <li key={b.accountId} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
                  <div className="flex items-center gap-2">
                    {b.ownerType === "company" ? (
                      <Building2 className="size-4 text-muted-foreground" />
                    ) : (
                      <UserIcon className="size-4 text-muted-foreground" />
                    )}
                    <span className="font-medium text-foreground">
                      {b.ownerType === "company" ? "صندوق الشركة" : b.ownerName ?? "—"}
                      {b.ownerUserId === user.id && b.ownerType === "user" && (
                        <span className="ms-2 text-xs font-normal text-muted-foreground">(أنت)</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span dir="ltr" className="font-bold text-foreground">
                      {formatILS(b.balance)}
                    </span>
                    {b.ownerType === "user" && b.ownerUserId && (
                      <Link
                        href={`/finance/technicians/${b.ownerUserId}`}
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                      >
                        عرض حركة الصندوق
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">تسليم النقدية</CardTitle>
          <HandOverCashDialog />
        </CardHeader>
        <CardContent className="p-0">
          {visibleTransfers.length === 0 ? (
            <EmptyState
              title="لا توجد عمليات تسليم بانتظار التأكيد"
              className="border-0 p-6"
            />
          ) : (
            <ul className="divide-y">
              {visibleTransfers.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
                  <div>
                    <div className="flex items-center gap-2">
                      <span dir="ltr" className="font-medium text-foreground">
                        {formatILS(t.amount)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        من {t.fromUserName ?? "—"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {dateTimeFmt.format(t.createdAt)}
                      {t.notes ? ` · ${t.notes}` : ""}
                    </p>
                  </div>
                  {canManageTechPayments && (isSuperAdmin(user) || t.fromUserId !== user.id) && (
                    <ConfirmTransferButton
                      transferId={t.id}
                      amount={t.amount}
                      fromUserName={t.fromUserName}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
