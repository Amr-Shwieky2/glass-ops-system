import type { Metadata } from "next";
import Link from "next/link";
import { Users, Wallet, FileCheck2 } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CashSection } from "./cash-section";
import { ChecksSection } from "./checks-section";

export const metadata: Metadata = { title: "الشؤون المالية | نظام إدارة عمليات الزجاج" };

export default async function FinancePage() {
  const user = await getCurrentUser();
  if (
    !user ||
    !canAny(user, [
      PERMISSIONS.VIEW_TECHNICIAN_BALANCES,
      PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS,
      PERMISSIONS.MANAGE_CHECKS,
      PERMISSIONS.COLLECT_PAYMENT,
      PERMISSIONS.APPROVE_PAYMENT,
    ])
  ) {
    return <Forbidden />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الشؤون المالية</h1>
          <p className="text-sm text-muted-foreground">
            الصناديق النقدية، تسليم النقدية، حسابات الفنيين، والشيكات.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/finance/technicians">
            <Users className="size-4" />
            حسابات الفنيين
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="cash">
        <TabsList>
          <TabsTrigger value="cash">
            <Wallet className="size-4" />
            الصناديق والتحويلات
          </TabsTrigger>
          <TabsTrigger value="checks">
            <FileCheck2 className="size-4" />
            الشيكات
          </TabsTrigger>
        </TabsList>
        <TabsContent value="cash">
          <CashSection user={user} />
        </TabsContent>
        <TabsContent value="checks">
          <ChecksSection user={user} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
