import type { Metadata } from "next";
import { FileX2, Ban, Clock, CheckCircle2, Ruler, Paperclip, FileType } from "lucide-react";
import {
  getProductionRequestByPublicToken,
  touchFactoryLinkAccess,
  type PublicProductionRequest,
} from "@/server/production/queries";
import { formatILS } from "@/server/money";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SubmitForm } from "./submit-form";

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

/** Production-relevant specs (Sprint 4) — job items, measurement details,
 * and the actual attachment files, via the factory-token-scoped retrieval
 * route (see getProductionRequestByPublicToken's own doc comment for the
 * exact exclusion list: no sale price, no customer identity, no internal
 * notes). Replaces the old "راجع صفحة المهمة للاطلاع عليها" text mention,
 * which pointed a factory contact — who has no login — at a page they
 * could never actually open. */
function ProductionSpecs({ data }: { data: PublicProductionRequest }) {
  if (data.items.length === 0 && data.measurements.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">تفاصيل الإنتاج</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {data.items.length > 0 && (
          <ul className="divide-y">
            {data.items.map((item) => (
              <li key={item.id} className="py-2">
                <p className="font-medium text-foreground">
                  {item.workTypeLabelAr || item.description || "بند عمل"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.description && item.workTypeLabelAr ? `${item.description} · ` : ""}
                  {item.quantity} {item.unit ?? ""}
                </p>
                {item.notes && (
                  <p className="mt-1 text-xs text-muted-foreground">ملاحظات الإنتاج: {item.notes}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {data.measurements.map((m) => (
          <div key={m.id} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2 text-foreground">
              <Ruler className="size-4 text-muted-foreground" />
              <span className="font-medium">{m.glassTypeLabelAr ?? "قياس"}</span>
            </div>
            {m.details && <p className="whitespace-pre-line text-muted-foreground">{m.details}</p>}
            {m.attachments.length > 0 && (
              <ul className="space-y-1">
                {m.attachments.map((a) => (
                  <li key={a.id}>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      {a.mimeType === "application/pdf" ? (
                        <FileType className="size-4" />
                      ) : (
                        <Paperclip className="size-4" />
                      )}
                      {a.fileName}
                      <span className="text-xs text-muted-foreground">
                        ({formatFileSize(a.sizeBytes)})
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export const metadata: Metadata = { title: "طلب إنتاج | إدارة عمليات الزجاج" };

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "long",
  day: "numeric",
  numberingSystem: "latn",
});

function StatusNotice({
  icon: Icon,
  title,
  description,
  tone = "muted",
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  tone?: "muted" | "success";
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <Icon
          className={`size-10 ${tone === "success" ? "text-green-600" : "text-muted-foreground"}`}
        />
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function RequestSummary({ data }: { data: PublicProductionRequest }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {data.job?.jobNumber} {data.job?.title ? `· ${data.job.title}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="whitespace-pre-line text-foreground">{data.request.details}</p>
        {data.request.estimatedReadyDate && (
          <p className="text-xs text-muted-foreground">
            جاهزية متوقعة (تقديرنا) {dateFmt.format(new Date(data.request.estimatedReadyDate))}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function LatestSubmissionSummary({ data }: { data: PublicProductionRequest }) {
  const submission = data.latestSubmission;
  if (!submission) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">آخر عرض تم إرساله</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between text-lg font-bold">
          <span>السعر</span>
          <span dir="ltr">{formatILS(submission.submittedPrice)}</span>
        </div>
        {submission.notes && <p className="text-muted-foreground">{submission.notes}</p>}
        <p className="text-xs text-muted-foreground">
          أُرسل بتاريخ {dateFmt.format(submission.submittedAt)}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function PublicProductionRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getProductionRequestByPublicToken(token);

  if (!data) {
    return (
      <StatusNotice
        icon={FileX2}
        title="الرابط غير صالح"
        description="تعذر العثور على طلب إنتاج مرتبط بهذا الرابط. تواصل معنا للحصول على رابط جديد."
      />
    );
  }

  await touchFactoryLinkAccess(token);

  if (data.isRevoked) {
    return (
      <StatusNotice
        icon={Ban}
        title="تم إلغاء هذا الرابط"
        description="لم يعد هذا الرابط صالحاً للاستخدام. تواصل معنا للحصول على رابط جديد."
      />
    );
  }

  if (data.request.status === "approved") {
    return (
      <div className="space-y-6">
        <StatusNotice
          icon={CheckCircle2}
          tone="success"
          title="تم اعتماد السعر"
          description="شكراً لكم. تم اعتماد السعر المرسل من طرفكم ولا حاجة لإجراء إضافي."
        />
        <RequestSummary data={data} />
        <LatestSubmissionSummary data={data} />
        <ProductionSpecs data={data} />
      </div>
    );
  }

  if (data.request.status === "submitted") {
    return (
      <div className="space-y-6">
        <StatusNotice
          icon={Clock}
          title="تم استلام عرضكم"
          description="عرض السعر بانتظار المراجعة من طرفنا، سنتواصل معكم عند اتخاذ القرار."
        />
        <RequestSummary data={data} />
        <LatestSubmissionSummary data={data} />
        <ProductionSpecs data={data} />
      </div>
    );
  }

  const rejected = data.request.status === "rejected" ? data.latestSubmission : null;

  return (
    <div className="space-y-6">
      <RequestSummary data={data} />
      {rejected && (
        <StatusNotice
          icon={Ban}
          title="تم رفض العرض السابق"
          description={rejected.rejectionReason || "يرجى إرسال سعر جديد."}
        />
      )}
      <ProductionSpecs data={data} />
      <SubmitForm token={token} />
    </div>
  );
}
