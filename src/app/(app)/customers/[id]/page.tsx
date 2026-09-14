import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, Phone, IdCard, Briefcase, Plus, ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getCustomerById, getCustomerJobs, isUserInvolvedWithCustomer } from "@/server/customers/queries";
import { formatILS } from "@/server/money";
import { jobStatusVariant } from "@/lib/job-status-style";
import { Forbidden } from "@/components/forbidden";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EditCustomerButton } from "../edit-customer-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const customer = await getCustomerById(id);
  return { title: `${customer?.name ?? "عميل"} | نظام إدارة عمليات الزجاج` };
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.VIEW_CUSTOMERS)) {
    return <Forbidden />;
  }

  const customer = await getCustomerById(id);
  if (!customer) notFound();

  // Sprint 1 security hardening: VIEW_CUSTOMERS alone used to be enough to
  // read ANY customer's full profile, national ID included, regardless of
  // whether the viewer has ever worked their jobs — live-demonstrated
  // during the Sprint 0 audit. Mirrors /jobs/[id]'s own "VIEW_ALL_JOBS or
  // involvement" gate, plus CREATE_CUSTOMER for the same reason listed on
  // the /customers list page (a customer with no job yet must still be
  // visible to whoever just created them).
  const canBrowseAll =
    can(user, PERMISSIONS.VIEW_ALL_JOBS) || can(user, PERMISSIONS.CREATE_CUSTOMER);
  if (!canBrowseAll && !(await isUserInvolvedWithCustomer(id, user!.id))) {
    return <Forbidden />;
  }

  const jobs = await getCustomerJobs(id);
  const canEdit = can(user, PERMISSIONS.EDIT_CUSTOMER);
  const canViewSalePrice = can(user, PERMISSIONS.VIEW_SALE_PRICE);

  return (
    <div className="space-y-6">
      <Link
        href="/customers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rotate-180" />
        العودة إلى العملاء
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">{customer.name}</h1>
        <div className="flex gap-2">
          {canEdit && (
            <EditCustomerButton
              customer={{
                id: customer.id,
                name: customer.name,
                phone: customer.phone,
                nationalId: customer.nationalId,
                address: customer.address,
                googleMapsUrl: customer.googleMapsUrl,
                notes: customer.notes,
              }}
            />
          )}
          <Button asChild>
            <Link href={`/jobs/new?customerId=${customer.id}`}>
              <Plus className="size-4" />
              مهمة جديدة
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">بيانات العميل</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span dir="ltr" className="text-foreground">
                {customer.phone}
              </span>
            </div>
            {customer.nationalId && (
              <div className="flex items-start gap-3">
                <IdCard className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span dir="ltr" className="text-foreground">
                  {customer.nationalId}
                </span>
              </div>
            )}
            {customer.address && (
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-foreground">{customer.address}</p>
                  {customer.googleMapsUrl && (
                    <a
                      href={customer.googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      فتح في خرائط جوجل
                    </a>
                  )}
                </div>
              </div>
            )}
            {customer.notes && (
              <div className="border-t pt-3 text-muted-foreground">
                {customer.notes}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">سجل المهام</CardTitle>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title="لا توجد مهام لهذا العميل بعد"
                className="border-0 p-6"
              />
            ) : (
              <ul className="divide-y">
                {jobs.map((job) => (
                  <li key={job.id} className="flex items-center justify-between py-3">
                    <div>
                      <Link
                        href={`/jobs/${job.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {job.jobNumber}
                      </Link>
                      {job.title && (
                        <p className="text-sm text-muted-foreground">{job.title}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {job.salePriceTotal && canViewSalePrice && (
                        <span dir="ltr" className="text-sm text-muted-foreground">
                          {formatILS(job.salePriceTotal)}
                        </span>
                      )}
                      <Badge variant={jobStatusVariant(job.statusKey)}>
                        {job.statusLabelAr}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
