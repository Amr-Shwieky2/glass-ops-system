import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getCustomerById } from "@/server/customers/queries";
import { Forbidden } from "@/components/forbidden";
import { NewJobForm } from "./new-job-form";

export const metadata: Metadata = { title: "مهمة جديدة | نظام إدارة عمليات الزجاج" };

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!canAny(user, [PERMISSIONS.VIEW_ALL_JOBS, PERMISSIONS.CREATE_CUSTOMER])) {
    return <Forbidden />;
  }

  const { customerId } = await searchParams;
  const preselectedCustomer = customerId ? await getCustomerById(customerId) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rotate-180" />
        العودة إلى المهام
      </Link>
      <h1 className="text-2xl font-bold text-foreground">مهمة جديدة</h1>
      <NewJobForm preselectedCustomer={preselectedCustomer} />
    </div>
  );
}
