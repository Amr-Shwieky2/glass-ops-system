import type { Metadata } from "next";
import { FileX2, Ban, Clock, CheckCircle2 } from "lucide-react";
import {
  getProductionRequestByPublicToken,
  touchFactoryLinkAccess,
  type PublicProductionRequest,
} from "@/server/production/queries";
import { formatILS } from "@/server/money";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SubmitForm } from "./submit-form";

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
      <SubmitForm token={token} />
    </div>
  );
}
