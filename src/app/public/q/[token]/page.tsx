import type { Metadata } from "next";
import { FileX2, Ban, Clock, CheckCircle2, Download } from "lucide-react";
import { getQuoteByPublicToken, touchPublicLinkAccess, type PublicQuote } from "@/server/quotes/queries";
import { formatILS } from "@/server/money";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SignForm } from "./sign-form";

export const metadata: Metadata = { title: "عرض السعر | إدارة عمليات الزجاج" };

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

function QuoteSummary({ data }: { data: PublicQuote }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>عرض سعر {data.quote.quoteNumber}</span>
          <span className="text-sm font-normal text-muted-foreground">
            الإصدار {data.version.versionNumber}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {data.job?.jobNumber} {data.job?.title ? `· ${data.job.title}` : ""}
        </div>
        <ul className="divide-y rounded-lg border">
          {data.version.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between p-3 text-sm">
              <div>
                <p className="font-medium text-foreground">
                  {item.workTypeLabelAr || item.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.quantity} {item.unit ?? ""} × {formatILS(item.unitPrice)}
                </p>
              </div>
              <span dir="ltr" className="font-medium text-foreground">
                {formatILS(item.lineTotal)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t pt-3 text-lg font-bold">
          <span>الإجمالي</span>
          <span dir="ltr">{formatILS(data.version.total)}</span>
        </div>
        {(data.version.paymentTerms || data.version.workTerms) && (
          <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
            {data.version.paymentTerms && <p>{data.version.paymentTerms}</p>}
            {data.version.workTerms && <p>{data.version.workTerms}</p>}
          </div>
        )}
        {data.version.validUntil && (
          <p className="text-xs text-muted-foreground">
            صالح حتى {dateFmt.format(new Date(data.version.validUntil))}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PdfLink({ token }: { token: string }) {
  return (
    <a
      href={`/api/public/quotes/${token}/pdf`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
    >
      <Download className="size-4" />
      تحميل نسخة PDF
    </a>
  );
}

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getQuoteByPublicToken(token);

  if (!data) {
    return (
      <StatusNotice
        icon={FileX2}
        title="الرابط غير صالح"
        description="تعذر العثور على عرض سعر مرتبط بهذا الرابط. تواصل معنا للحصول على رابط جديد."
      />
    );
  }

  await touchPublicLinkAccess(token);

  if (data.isRevoked) {
    return (
      <StatusNotice
        icon={Ban}
        title="تم إلغاء هذا الرابط"
        description="لم يعد هذا الرابط صالحاً للاستخدام. تواصل معنا للحصول على رابط جديد."
      />
    );
  }

  if (data.version.isSigned) {
    return (
      <div className="space-y-6">
        <StatusNotice
          icon={CheckCircle2}
          tone="success"
          title="تم توقيع عرض السعر"
          description={`تم التوقيع بتاريخ ${dateFmt.format(data.signature!.signedAt)} بواسطة ${data.signature!.customerNameAtSigning}. شكراً لك.`}
        />
        <QuoteSummary data={data} />
        <div className="text-center">
          <PdfLink token={token} />
        </div>
      </div>
    );
  }

  if (data.isExpired) {
    return (
      <div className="space-y-6">
        <StatusNotice
          icon={Clock}
          title="انتهت صلاحية هذا العرض"
          description="انتهت صلاحية عرض السعر هذا. تواصل معنا لإصدار عرض جديد."
        />
        <QuoteSummary data={data} />
        <div className="text-center">
          <PdfLink token={token} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <QuoteSummary data={data} />
      <div className="text-center">
        <PdfLink token={token} />
      </div>
      <SignForm
        token={token}
        defaultName={data.customer?.name ?? ""}
        defaultPhone={data.customer?.phone ?? ""}
        defaultAddress={data.customer?.address ?? ""}
      />
    </div>
  );
}
