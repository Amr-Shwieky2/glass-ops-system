import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MapPin,
  Phone,
  IdCard,
  Briefcase,
  Plus,
  ArrowLeft,
  FileSignature,
  Wallet,
  FileCheck2,
  Wrench,
  History,
  Banknote,
} from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import {
  getCustomerById,
  getCustomerJobs,
  isUserInvolvedWithCustomer,
  getCustomerQuotes,
  getCustomerPayments,
  getCustomerIncomingChecks,
  getCustomerOutstandingBalance,
  getCustomerRepairs,
  getCustomerActivity,
} from "@/server/customers/queries";
import { formatILS } from "@/server/money";
import {
  computePaymentStatus,
  PAYMENT_STATUS_LABEL_AR,
  type PaymentStatus,
} from "@/server/jobs/payment-status";
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

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

const dateTimeFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn",
});

const QUOTE_STATUS_LABEL_AR: Record<string, string> = {
  draft: "مسودة",
  sent: "مُرسل",
  signed: "موقّع",
  expired: "منتهي",
  superseded: "مستبدل",
};

const QUOTE_STATUS_VARIANT: Record<string, "outline" | "info" | "success" | "destructive"> = {
  draft: "outline",
  sent: "info",
  signed: "success",
  expired: "destructive",
  superseded: "outline",
};

const PAYMENT_METHOD_LABEL_AR: Record<string, string> = {
  cash: "نقدية",
  bank_transfer: "تحويل بنكي",
  check: "شيك",
  other: "أخرى",
};

const APPROVAL_STATUS_LABEL_AR: Record<string, string> = {
  pending: "بانتظار الاعتماد",
  approved: "معتمد",
  rejected: "مرفوض",
};

const APPROVAL_STATUS_VARIANT: Record<string, "warning" | "success" | "destructive"> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
};

const CHECK_STATUS_LABEL_AR: Record<string, string> = {
  future: "مستقبلي",
  due_soon: "مستحق قريباً",
  deposited: "تم الإيداع",
  cleared: "تم التحصيل",
  failed: "فشل",
  cancelled: "ملغى",
};

const REPAIR_STATUS_LABEL_AR: Record<string, string> = {
  open: "مفتوح",
  scheduled: "مجدول",
  in_progress: "قيد التنفيذ",
  resolved: "تم الحل",
};

const REPAIR_STATUS_VARIANT: Record<string, "destructive" | "warning" | "info" | "success"> = {
  open: "destructive",
  scheduled: "warning",
  in_progress: "info",
  resolved: "success",
};

const PAYMENT_STATUS_BADGE_VARIANT: Record<PaymentStatus, "outline" | "warning" | "success"> = {
  not_paid: "outline",
  partially_paid: "warning",
  fully_paid: "success",
};

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

  const canEdit = can(user, PERMISSIONS.EDIT_CUSTOMER);
  const canViewSalePrice = can(user, PERMISSIONS.VIEW_SALE_PRICE);
  const canViewChecks = can(user, PERMISSIONS.MANAGE_CHECKS);

  // Sprint 6 (R1.15/S6.1/S6.4): the 6 sections beyond profile+jobs this
  // page was previously missing. Financial sections (quotes carry prices,
  // payments, outstanding balance) are gated the SAME way the job page
  // already gates its own sale price/payments — never rendered just
  // because a viewer can see this customer at all. Repairs and the
  // activity timeline carry no pricing, so they're visible to anyone who
  // passed the involvement check above.
  const [jobs, quotesResult, paymentsResult, checksResult, balanceResult, repairsResult, activityResult] =
    await Promise.all([
      getCustomerJobs(id),
      canViewSalePrice ? getCustomerQuotes(id) : Promise.resolve([]),
      canViewSalePrice ? getCustomerPayments(id) : Promise.resolve([]),
      canViewChecks ? getCustomerIncomingChecks(id) : Promise.resolve([]),
      canViewSalePrice
        ? getCustomerOutstandingBalance(id)
        : Promise.resolve(null),
      getCustomerRepairs(id),
      getCustomerActivity(id),
    ]);

  const paymentStatus = canViewSalePrice && balanceResult
    ? computePaymentStatus(balanceResult.salePriceTotal, balanceResult.totalPaid)
    : null;

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

      {canViewSalePrice && balanceResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="size-5 text-muted-foreground" />
              الرصيد المستحق
              {paymentStatus && (
                <Badge variant={PAYMENT_STATUS_BADGE_VARIANT[paymentStatus]}>
                  {PAYMENT_STATUS_LABEL_AR[paymentStatus]}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">إجمالي قيمة البيع</p>
              <p dir="ltr" className="text-end text-xl font-bold text-foreground">
                {formatILS(balanceResult.salePriceTotal)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">المحصَّل</p>
              <p dir="ltr" className="text-end text-xl font-bold text-foreground">
                {formatILS(balanceResult.totalPaid)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">المتبقي</p>
              <p dir="ltr" className="text-end text-xl font-bold text-foreground">
                {formatILS(balanceResult.remaining)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {canViewSalePrice && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSignature className="size-5 text-muted-foreground" />
              عروض الأسعار
            </CardTitle>
          </CardHeader>
          <CardContent>
            {quotesResult.length === 0 ? (
              <EmptyState title="لا توجد عروض أسعار لهذا العميل بعد" className="border-0 p-6" />
            ) : (
              <ul className="divide-y">
                {quotesResult.map((q) => (
                  <li key={q.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium text-foreground">{q.quoteNumber}</p>
                      <Link
                        href={`/jobs/${q.jobId}`}
                        className="text-sm text-muted-foreground hover:underline"
                      >
                        {q.jobNumber} · {dateFmt.format(q.createdAt)}
                      </Link>
                    </div>
                    <div className="flex items-center gap-3">
                      {q.total && (
                        <span dir="ltr" className="text-sm text-muted-foreground">
                          {formatILS(q.total)}
                        </span>
                      )}
                      <Badge variant={QUOTE_STATUS_VARIANT[q.status] ?? "outline"}>
                        {QUOTE_STATUS_LABEL_AR[q.status] ?? q.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {canViewSalePrice && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="size-5 text-muted-foreground" />
              المدفوعات
            </CardTitle>
          </CardHeader>
          <CardContent>
            {paymentsResult.length === 0 ? (
              <EmptyState title="لم يتم تسجيل أي دفعة بعد" className="border-0 p-6" />
            ) : (
              <ul className="divide-y">
                {paymentsResult.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span dir="ltr" className="font-medium text-foreground">
                          {formatILS(p.amount)}
                        </span>
                        <Badge variant={APPROVAL_STATUS_VARIANT[p.approvalStatus] ?? "outline"}>
                          {APPROVAL_STATUS_LABEL_AR[p.approvalStatus] ?? p.approvalStatus}
                        </Badge>
                      </div>
                      <Link
                        href={`/jobs/${p.jobId}`}
                        className="text-sm text-muted-foreground hover:underline"
                      >
                        {p.jobNumber} · {PAYMENT_METHOD_LABEL_AR[p.method] ?? p.method} ·{" "}
                        {p.receivedByUserName ?? "—"} ·{" "}
                        {dateFmt.format(new Date(p.paymentDate))}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {canViewChecks && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCheck2 className="size-5 text-muted-foreground" />
              الشيكات الواردة
            </CardTitle>
          </CardHeader>
          <CardContent>
            {checksResult.length === 0 ? (
              <EmptyState title="لا توجد شيكات لهذا العميل" className="border-0 p-6" />
            ) : (
              <ul className="divide-y">
                {checksResult.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span dir="ltr" className="font-medium text-foreground">
                          {formatILS(c.amount)}
                        </span>
                        <Badge variant={c.isDueSoon ? "warning" : "outline"}>
                          {CHECK_STATUS_LABEL_AR[c.status] ?? c.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {c.jobNumber ? (
                          <Link href={`/jobs/${c.jobId}`} className="hover:underline">
                            {c.jobNumber}
                          </Link>
                        ) : (
                          "بدون مهمة"
                        )}{" "}
                        · استحقاق {dateFmt.format(new Date(`${c.dueDate}T00:00:00`))}
                        {c.bank ? ` · ${c.bank}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="size-5 text-muted-foreground" />
            الإصلاحات (تيكون)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {repairsResult.length === 0 ? (
            <EmptyState title="لا توجد إصلاحات لهذا العميل" className="border-0 p-6" />
          ) : (
            <ul className="divide-y">
              {repairsResult.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-foreground">{r.problemDescription}</p>
                    <Link
                      href={`/jobs/${r.jobId}`}
                      className="text-sm text-muted-foreground hover:underline"
                    >
                      {r.jobNumber} · أُبلغ عنه {dateFmt.format(new Date(`${r.dateReported}T00:00:00`))}
                      {r.responsibleUserName ? ` · ${r.responsibleUserName}` : ""}
                    </Link>
                  </div>
                  <Badge variant={REPAIR_STATUS_VARIANT[r.status] ?? "outline"}>
                    {REPAIR_STATUS_LABEL_AR[r.status] ?? r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-5 text-muted-foreground" />
            النشاط الأخير
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activityResult.length === 0 ? (
            <EmptyState title="لا يوجد نشاط مسجل بعد" className="border-0 p-6" />
          ) : (
            <ul className="divide-y">
              {activityResult.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                      {a.action}
                    </span>
                    <Link href={`/jobs/${a.jobId}`} className="text-foreground hover:underline">
                      {a.jobNumber}
                    </Link>
                    {a.userName && (
                      <span className="text-muted-foreground">بواسطة {a.userName}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {dateTimeFmt.format(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
