import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getUserDetail } from "@/server/users/queries";
import { getVehiclesList } from "@/server/vehicles/queries";
import { formatILS } from "@/server/money";
import { Forbidden } from "@/components/forbidden";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EditUserDialog } from "./edit-user-dialog";
import { StatusToggleButton } from "./status-toggle-button";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { PermissionsEditor } from "./permissions-editor";

export const metadata: Metadata = { title: "بيانات المستخدم | نظام إدارة عمليات الزجاج" };

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getCurrentUser();
  if (!can(viewer, PERMISSIONS.MANAGE_USERS)) {
    return <Forbidden />;
  }

  const [detail, vehicles] = await Promise.all([getUserDetail(id), getVehiclesList()]);
  if (!detail) notFound();

  const activeVehicles = vehicles
    .filter((v) => v.isActive)
    .map((v) => ({ id: v.id, name: v.name }));
  const defaultVehicleName =
    detail.defaultVehicleId != null
      ? (vehicles.find((v) => v.id === detail.defaultVehicleId)?.name ?? "—")
      : null;

  const viewerCanManagePermissions = can(viewer, PERMISSIONS.MANAGE_PERMISSIONS);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{detail.name}</h1>
            <Badge variant={detail.status === "active" ? "success" : "warning"}>
              {detail.status === "active" ? "نشط" : "موقوف"}
            </Badge>
          </div>
          <p dir="ltr" className="text-end text-sm text-muted-foreground">
            {detail.phone}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EditUserDialog detail={detail} vehicles={activeVehicles} />
          <ResetPasswordDialog userId={detail.id} />
          <StatusToggleButton userId={detail.id} currentStatus={detail.status} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">البيانات الأساسية</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">البريد الإلكتروني</p>
            <p className="text-sm text-foreground">{detail.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">المركبة الافتراضية</p>
            <p className="text-sm text-foreground">{defaultVehicleName ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">الأجر اليومي</p>
            <p dir="ltr" className="text-end text-sm text-foreground">
              {detail.dailyWageAmount ? formatILS(detail.dailyWageAmount) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">تاريخ الإنشاء</p>
            <p className="text-sm text-foreground">
              {new Intl.DateTimeFormat("ar", {
                year: "numeric",
                month: "short",
                day: "numeric",
                numberingSystem: "latn",
              }).format(detail.createdAt)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">الصلاحيات</CardTitle>
          {!viewerCanManagePermissions && (
            <p className="text-xs text-muted-foreground">
              للعرض فقط — لا تملك صلاحية إدارة الصلاحيات.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <PermissionsEditor
            userId={detail.id}
            initialGranted={detail.permissionKeys}
            editable={viewerCanManagePermissions}
          />
        </CardContent>
      </Card>
    </div>
  );
}
