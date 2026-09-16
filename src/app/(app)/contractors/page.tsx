import type { Metadata } from "next";
import { HardHat } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { listContractors } from "@/server/contractors/queries";
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
import { AddContractorButton } from "./add-contractor-button";
import { EditContractorButton } from "./edit-contractor-button";
import { ToggleActiveButton } from "./toggle-active-button";

export const metadata: Metadata = { title: "المقاولون الخارجيون | نظام إدارة عمليات الزجاج" };

/** Sprint 7 (R1.31) — the management roster for external_contractors.
 * Gated the same as assigning one to a job (ASSIGN_INSTALLER): the
 * natural boundary for "who manages the roster of contractors available
 * to assign," since before this page the ONLY way a contractor could
 * exist at all was a hand-written seed.ts row. */
export default async function ContractorsPage() {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.ASSIGN_INSTALLER)) {
    return <Forbidden />;
  }

  const contractors = await listContractors();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">المقاولون الخارجيون</h1>
          <p className="text-sm text-muted-foreground">
            {contractors.length} {contractors.length === 1 ? "مقاول" : "مقاولين"}
          </p>
        </div>
        <AddContractorButton />
      </div>

      <Card>
        <CardContent className="p-0">
          {contractors.length === 0 ? (
            <EmptyState
              icon={HardHat}
              title="لا يوجد مقاولون خارجيون"
              description="أضف أول مقاول للبدء."
              className="border-0"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الهاتف</TableHead>
                    <TableHead>نوع الخدمة</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contractors.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                      <TableCell dir="ltr" className="text-end text-muted-foreground">
                        {c.phone ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.serviceType ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.isActive ? "success" : "outline"}>
                          {c.isActive ? "نشط" : "غير نشط"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <EditContractorButton
                            contractor={{
                              id: c.id,
                              name: c.name,
                              phone: c.phone,
                              serviceType: c.serviceType,
                              notes: c.notes,
                            }}
                          />
                          <ToggleActiveButton contractorId={c.id} isActive={c.isActive} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
