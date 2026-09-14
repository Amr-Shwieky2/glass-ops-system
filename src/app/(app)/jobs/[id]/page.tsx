import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ruler, ListChecks, Users2, MapPin, Calendar, Paperclip } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can, canAny, isSuperAdmin } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import {
  getJobDetail,
  getAllWorkTypes,
  getAssignableUsers,
  getActiveExternalContractors,
} from "@/server/jobs/queries";
import { getQuoteForJob } from "@/server/quotes/queries";
import { defaultQuoteValidUntil } from "@/server/quotes/versions";
import { getProductionRequestForJob } from "@/server/production/queries";
import { getJobAppointments } from "@/server/appointments/queries";
import { getJobPayments } from "@/server/payments/queries";
import { getJobCostsForJob, getJobProfitability } from "@/server/costs/queries";
import { getJobRepairs } from "@/server/repairs/queries";
import { unitLabelAr } from "@/lib/units";
import {
  getJobCompensationEntries,
  getCompensationRules,
  getBonusRules,
  getPenaltyRules,
} from "@/server/compensation/queries";
import { getCommissionForJob } from "@/server/compensation/commission";
import { getSetting } from "@/server/settings";
import { formatILS, sumMoney } from "@/server/money";
import { jobStatusVariant } from "@/lib/job-status-style";
import { Forbidden } from "@/components/forbidden";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LocationButtons } from "@/components/location-buttons";
import { AddMeasurementDialog } from "./add-measurement-dialog";
import { AddJobItemDialog } from "./add-job-item-dialog";
import { QuoteSection } from "./quote-section";
import { ProductionSection } from "./production-section";
import { AppointmentsSection } from "./appointments-section";
import { PaymentsSection } from "./payments-section";
import { CostsSection } from "./costs-section";
import { CompensationSection } from "./compensation-section";
import { getCompensationEntryTechnicianNames } from "./get-compensation-entry-technicians";
import { AssignDialog } from "./assign-dialog";
import { CancelJobDialog } from "./cancel-job-dialog";
import { CloseJobButton } from "./close-job-button";
import { RepairsSection } from "./repairs-section";
import { ConfirmRemoveButton } from "./confirm-remove-button";
import { FieldMeasurementSuccessToast } from "./field-measurement-success-toast";
import { deleteJobItem, removeAssignment } from "@/server/jobs/actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const job = await getJobDetail(id);
  return { title: `${job?.jobNumber ?? "مهمة"} | نظام إدارة عمليات الزجاج` };
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

/** Small local formatter for measurement-attachment sizes — no shared
 * "format bytes" helper exists elsewhere in this codebase yet, and one
 * extra reading here doesn't warrant introducing one. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!canAny(user, [PERMISSIONS.VIEW_ALL_JOBS, PERMISSIONS.VIEW_ASSIGNED_JOBS])) {
    return <Forbidden />;
  }

  const job = await getJobDetail(id);
  if (!job) notFound();

  const isInvolved =
    job.measuredByUserId === user!.id ||
    job.pricingResponsibleUserId === user!.id ||
    job.dealClosedByUserId === user!.id ||
    job.assignments.some((a) => a.userId === user!.id);
  if (!can(user, PERMISSIONS.VIEW_ALL_JOBS) && !isInvolved) {
    return <Forbidden message="هذه المهمة غير مسندة إليك." />;
  }

  const [
    workTypes,
    assignableUsers,
    externalContractors,
    quote,
    quoteValidityDays,
    productionRequest,
    jobAppointments,
    jobPayments,
    jobCostsResult,
    jobProfitability,
    compensationEntries,
    technicianNameByEntryId,
    commission,
    compensationRules,
    bonusRules,
    penaltyRules,
    jobRepairs,
  ] = await Promise.all([
    getAllWorkTypes(),
    getAssignableUsers(),
    getActiveExternalContractors(),
    getQuoteForJob(job.id),
    getSetting("quote_validity_days"),
    getProductionRequestForJob(job.id),
    getJobAppointments(job.id),
    getJobPayments(job.id),
    getJobCostsForJob(job.id),
    getJobProfitability(job.id),
    getJobCompensationEntries(job.id),
    getCompensationEntryTechnicianNames(job.id),
    getCommissionForJob(job.id),
    getCompensationRules(),
    getBonusRules(),
    getPenaltyRules(),
    getJobRepairs(job.id),
  ]);

  const canCreateMeasurement = can(user, PERMISSIONS.CREATE_MEASUREMENT);
  const canManagePricing = canAny(user, [
    PERMISSIONS.CREATE_PRICE,
    PERMISSIONS.EDIT_PRICE,
  ]);
  const canCreateQuote = can(user, PERMISSIONS.CREATE_QUOTE);
  const canSendQuote = can(user, PERMISSIONS.SEND_QUOTE);
  const canCloseDeal = can(user, PERMISSIONS.CLOSE_DEAL);
  const canAssign = can(user, PERMISSIONS.ASSIGN_INSTALLER);
  const canCancel = can(user, PERMISSIONS.CLOSE_DEAL) && !job.isTerminal;
  const canClose = can(user, PERMISSIONS.CLOSE_DEAL) && !job.isTerminal;
  const canCreateRepair = can(user, PERMISSIONS.CREATE_REPAIR);
  const canCreateProductionOrder = can(user, PERMISSIONS.CREATE_PRODUCTION_ORDER);
  const canApproveFactoryPrice = can(user, PERMISSIONS.APPROVE_FACTORY_PRICE);
  const canScheduleAppointment = canAny(user, [
    PERMISSIONS.CREATE_MEASUREMENT,
    PERMISSIONS.ASSIGN_INSTALLER,
    PERMISSIONS.CREATE_REPAIR,
    PERMISSIONS.VIEW_ALL_JOBS,
  ]);
  const canCollectPayment = can(user, PERMISSIONS.COLLECT_PAYMENT);
  const canApprovePayment = can(user, PERMISSIONS.APPROVE_PAYMENT);
  const canViewPayments = canAny(user, [
    PERMISSIONS.COLLECT_PAYMENT,
    PERMISSIONS.APPROVE_PAYMENT,
    PERMISSIONS.VIEW_JOB_COSTS,
  ]);
  const canViewJobCosts = can(user, PERMISSIONS.VIEW_JOB_COSTS);
  const canViewProfitability = can(user, PERMISSIONS.VIEW_PROFITABILITY);
  const canManageJobCosts = can(user, PERMISSIONS.MANAGE_JOB_COSTS);
  const canApproveRequests = can(user, PERMISSIONS.APPROVE_REQUESTS);
  const canViewCompensation = canAny(user, [
    PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS,
    PERMISSIONS.VIEW_TECHNICIAN_BALANCES,
    PERMISSIONS.VIEW_PROFITABILITY,
  ]);
  // Distinct from canViewCompensation above (which only gates whether the
  // section renders at all): a technician's individual ledger entries
  // (name, penalty/bonus reasons, per-entry amounts) are the same kind of
  // technician-identifying data /finance/technicians correctly requires
  // VIEW_TECHNICIAN_BALANCES for — VIEW_PROFITABILITY alone (aggregate
  // revenue/cost/margin visibility, not per-technician identity) must not
  // be sufficient to see them here either.
  const canViewTechnicianLedger = canAny(user, [
    PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS,
    PERMISSIONS.VIEW_TECHNICIAN_BALANCES,
  ]);
  const canManageTechnicianPayments = can(user, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS);
  // Sprint 1 (security hardening): the agreed sale price is a protected
  // financial value like profitability/job-costs (section 65) — it must
  // never reach a viewer, e.g. an assigned installer, who holds none of
  // the pricing/financial permissions. See PERMISSIONS.VIEW_SALE_PRICE.
  const canViewSalePrice = can(user, PERMISSIONS.VIEW_SALE_PRICE);

  const defaultValidUntil = defaultQuoteValidUntil(quoteValidityDays);

  const itemsTotal = job.items.length
    ? sumMoney(job.items.map((i) => i.salePrice ?? "0"))
    : null;

  const responsibleUserNameById = Object.fromEntries(
    assignableUsers.map((u) => [u.id, u.name]),
  );

  return (
    <div className="space-y-6">
      <FieldMeasurementSuccessToast statusKey={job.statusKey} />

      <Link
        href="/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rotate-180" />
        العودة إلى المهام
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{job.jobNumber}</h1>
            <Badge variant={jobStatusVariant(job.statusKey)}>{job.statusLabelAr}</Badge>
          </div>
          {job.title && <p className="text-muted-foreground">{job.title}</p>}
        </div>
        <div className="flex items-center gap-2">
          {canClose && <CloseJobButton jobId={job.id} />}
          {canCancel && <CancelJobDialog jobId={job.id} />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">نظرة عامة</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">العميل</p>
              <Link
                href={`/customers/${job.customerId}`}
                className="font-medium text-foreground hover:underline"
              >
                {job.customerName}
              </Link>
              <p dir="ltr" className="text-end text-muted-foreground">
                {job.customerPhone}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">العنوان</p>
              <p className="flex items-center gap-1 font-medium text-foreground">
                <MapPin className="size-4 text-muted-foreground" />
                {job.address ?? job.customerAddress ?? "—"}
              </p>
              <div className="mt-2">
                <LocationButtons
                  phone={job.customerPhone}
                  address={job.address ?? job.customerAddress}
                  latitude={job.latitude ?? job.customerLatitude}
                  longitude={job.longitude ?? job.customerLongitude}
                  googleMapsUrl={job.customerGoogleMapsUrl}
                />
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">تاريخ الإنشاء</p>
              <p className="flex items-center gap-1 font-medium text-foreground">
                <Calendar className="size-4 text-muted-foreground" />
                {dateFmt.format(job.createdAt)}
              </p>
            </div>
            {job.salePriceTotal && canViewSalePrice && (
              <div>
                <p className="text-muted-foreground">قيمة البيع الإجمالية</p>
                <p dir="ltr" className="text-end font-medium text-foreground">
                  {formatILS(job.salePriceTotal)}
                </p>
              </div>
            )}
            {job.notes && (
              <div className="sm:col-span-2">
                <p className="text-muted-foreground">ملاحظات</p>
                <p className="text-foreground">{job.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">بنود العمل</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground" dir="ltr">
              {itemsTotal && canViewSalePrice ? formatILS(itemsTotal) : "—"}
            </p>
            <p className="text-sm text-muted-foreground">
              {job.items.length} {job.items.length === 1 ? "بند" : "بنود"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ruler className="size-5 text-muted-foreground" />
            القياسات
          </CardTitle>
          {canCreateMeasurement && (
            <AddMeasurementDialog jobId={job.id} assignableUsers={assignableUsers} />
          )}
        </CardHeader>
        <CardContent>
          {job.measurements.length === 0 ? (
            <EmptyState title="لم يُسجَّل أي قياس بعد" className="border-0 p-6" />
          ) : (
            <ul className="divide-y">
              {job.measurements.map((m) => (
                <li key={m.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">
                      {dateTimeFmt.format(m.measuredAt)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      بواسطة {m.measuredByName}
                      {m.photosTaken ? " · تم توثيق الصور" : ""}
                    </span>
                  </div>
                  {m.details && (
                    <p className="mt-1 text-sm text-muted-foreground">{m.details}</p>
                  )}

                  {/* Field submission data (New Measurement quick-submit
                      flow, docs/superpowers/specs/
                      2026-09-03-new-measurement-quick-submit-design.md
                      section 7 step 4) — all null on an ordinary
                      office-recorded measurement, so nothing extra renders
                      for those. */}
                  {m.glassTypeLabelAr && (
                    <div className="mt-2">
                      <Badge variant="outline">نوع الزجاج: {m.glassTypeLabelAr}</Badge>
                    </div>
                  )}

                  {m.fieldQuotedPrice && (
                    <div className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-sm">
                      <p className="font-medium text-foreground" dir="ltr">
                        {formatILS(m.fieldQuotedPrice)}
                        {" · "}
                        {m.fieldQuotedPriceIncludesVat ? "شامل الضريبة" : "قبل الضريبة"}
                      </p>
                      <p className="text-xs text-warning">
                        سعر مرجعي من الميدان — غير ملزم
                      </p>
                    </div>
                  )}

                  {m.attachments.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {m.attachments.map((a) => (
                        <li key={a.id}>
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                          >
                            <Paperclip className="size-3.5 shrink-0" />
                            <span className="truncate">{a.fileName}</span>
                            <span dir="ltr" className="shrink-0 text-xs text-muted-foreground">
                              ({formatFileSize(a.sizeBytes)})
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="size-5 text-muted-foreground" />
            بنود العمل والتسعير
          </CardTitle>
          {canManagePricing && (
            <AddJobItemDialog jobId={job.id} workTypes={workTypes} />
          )}
        </CardHeader>
        <CardContent>
          {job.items.length === 0 ? (
            <EmptyState title="لا توجد بنود عمل بعد" className="border-0 p-6" />
          ) : (
            <ul className="divide-y">
              {job.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {item.workTypeLabelAr ?? item.description ?? "بند عمل"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.description && item.workTypeLabelAr ? `${item.description} · ` : ""}
                      {item.quantity} {unitLabelAr(item.unit)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.salePrice && canViewSalePrice && (
                      <span dir="ltr" className="text-sm font-medium text-foreground">
                        {formatILS(item.salePrice)}
                      </span>
                    )}
                    {canManagePricing && (
                      <ConfirmRemoveButton
                        title="حذف البند"
                        description="سيتم حذف هذا البند نهائياً من المهمة."
                        onConfirm={deleteJobItem.bind(null, job.id, item.id)}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <QuoteSection
        jobId={job.id}
        quote={quote}
        jobItems={job.items}
        jobSourceQuoteVersionId={job.sourceQuoteVersionId}
        workTypes={workTypes}
        customerPhone={job.customerPhone}
        defaultValidUntil={defaultValidUntil}
        canCreateQuote={canCreateQuote}
        canSendQuote={canSendQuote}
        canCloseDeal={canCloseDeal}
        canViewSalePrice={canViewSalePrice}
      />

      <ProductionSection
        jobId={job.id}
        request={productionRequest}
        jobItems={job.items}
        canCreateProductionOrder={canCreateProductionOrder}
        canApproveFactoryPrice={canApproveFactoryPrice}
        canViewJobCosts={canViewJobCosts}
      />

      {canViewJobCosts && (
        <CostsSection
          jobId={job.id}
          costsResult={jobCostsResult}
          profitability={jobProfitability}
          canViewProfitability={canViewProfitability}
          canManageJobCosts={canManageJobCosts}
          canApproveRequests={canApproveRequests}
          currentUserId={user!.id}
          isSuperAdminUser={isSuperAdmin(user)}
          externalContractors={externalContractors}
        />
      )}

      <AppointmentsSection
        jobId={job.id}
        appointments={jobAppointments}
        assignableUsers={assignableUsers}
        canScheduleAppointment={canScheduleAppointment}
      />

      {canCreateRepair && (
        <RepairsSection
          jobId={job.id}
          repairs={jobRepairs}
          assignableUsers={assignableUsers}
          responsibleUserNameById={responsibleUserNameById}
        />
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users2 className="size-5 text-muted-foreground" />
            الفنيون المعيّنون
          </CardTitle>
          {canAssign && (
            <AssignDialog
              jobId={job.id}
              assignableUsers={assignableUsers}
              externalContractors={externalContractors}
            />
          )}
        </CardHeader>
        <CardContent>
          {job.assignments.length === 0 ? (
            <EmptyState title="لم يتم تعيين أي فني بعد" className="border-0 p-6" />
          ) : (
            <ul className="divide-y">
              {job.assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {a.userName ?? a.externalContractorName}
                    </p>
                    {a.role && <p className="text-sm text-muted-foreground">{a.role}</p>}
                  </div>
                  {canAssign && (
                    <ConfirmRemoveButton
                      title="إزالة التعيين"
                      description="سيتم إزالة هذا الفني من المهمة."
                      onConfirm={removeAssignment.bind(null, job.id, a.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canViewPayments && (
        <PaymentsSection
          jobId={job.id}
          hasSalePrice={job.salePriceTotal !== null}
          paymentsResult={jobPayments}
          canCollectPayment={canCollectPayment}
          canApprovePayment={canApprovePayment}
          currentUserId={user!.id}
          isSuperAdminUser={isSuperAdmin(user)}
        />
      )}

      {canViewCompensation && (
        <CompensationSection
          jobId={job.id}
          entries={compensationEntries}
          technicianNameByEntryId={technicianNameByEntryId}
          commission={commission}
          assignableUsers={assignableUsers}
          compensationRules={compensationRules}
          bonusRules={bonusRules}
          penaltyRules={penaltyRules}
          jobItems={job.items}
          canManageTechnicianPayments={canManageTechnicianPayments}
          canViewTechnicianLedger={canViewTechnicianLedger}
        />
      )}
    </div>
  );
}
