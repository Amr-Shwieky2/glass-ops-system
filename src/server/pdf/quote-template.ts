import type { SettingsSchema } from "@/server/settings-defaults";
import { formatILS } from "@/server/money";

export interface QuoteTemplateItem {
  description: string;
  workTypeLabelAr?: string | null;
  quantity: string;
  unit?: string | null;
  unitPrice: string;
  lineTotal: string;
}

export interface QuoteTemplateData {
  companyInfo: SettingsSchema["company_info"];
  quoteNumber: string;
  versionNumber: number;
  createdAt: Date;
  validUntil?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  jobNumber: string;
  jobTitle?: string | null;
  items: QuoteTemplateItem[];
  subtotal: string;
  total: string;
  paymentTerms?: string | null;
  workTerms?: string | null;
  notes?: string | null;
  signature?: {
    signedAt: Date;
    customerNameAtSigning: string;
    signatureImage: string;
  } | null;
}

function esc(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "long",
  day: "numeric",
  numberingSystem: "latn",
});

/** Pure function: assembles the full self-contained HTML document for a
 * quote (section 18). Rendered to PDF via src/server/pdf/render.ts. Uses
 * the system-installed Noto Naskh Arabic font by name (the PDF is rendered
 * by a Chromium this same server controls, not shipped to an arbitrary
 * viewer's browser, so referencing an OS font is correct here — unlike a
 * page served live to the public, which cannot assume any font exists). */
export function renderQuoteHtml(data: QuoteTemplateData): string {
  const rows = data.items
    .map(
      (item, i) => `
      <tr>
        <td class="idx">${i + 1}</td>
        <td class="desc">${esc(item.workTypeLabelAr || item.description)}${
          item.workTypeLabelAr && item.description && item.description !== item.workTypeLabelAr
            ? `<div class="desc-sub">${esc(item.description)}</div>`
            : ""
        }</td>
        <td class="num">${esc(item.quantity)} ${esc(item.unit || "")}</td>
        <td class="num">${formatILS(item.unitPrice)}</td>
        <td class="num strong">${formatILS(item.lineTotal)}</td>
      </tr>`,
    )
    .join("");

  const signatureBlock = data.signature
    ? `
      <div class="sign-box signed">
        <p class="sign-label">توقيع العميل</p>
        <img src="${data.signature.signatureImage}" alt="التوقيع" class="sign-img" />
        <p class="sign-meta">${esc(data.signature.customerNameAtSigning)} · ${dateFmt.format(data.signature.signedAt)}</p>
      </div>`
    : `
      <div class="sign-box">
        <p class="sign-label">توقيع العميل</p>
        <div class="sign-line"></div>
        <p class="sign-meta">الاسم والتاريخ</p>
      </div>`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>عرض سعر ${esc(data.quoteNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Noto Naskh Arabic", "Noto Sans Arabic", sans-serif;
    color: #1a1a1a;
    font-size: 13px;
    line-height: 1.6;
    margin: 0;
    padding: 0;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #1a3c6e;
    padding-bottom: 14px;
    margin-bottom: 20px;
  }
  .company-name { font-size: 20px; font-weight: 700; color: #1a3c6e; }
  .company-meta { font-size: 12px; color: #555; margin-top: 4px; }
  .doc-title { text-align: start; }
  .doc-title h1 { font-size: 18px; margin: 0 0 6px; color: #1a3c6e; }
  .doc-title p { margin: 2px 0; font-size: 12px; color: #444; }
  .parties {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
  }
  .party { flex: 1; background: #f6f8fb; border-radius: 8px; padding: 12px 14px; }
  .party h3 { margin: 0 0 6px; font-size: 12px; color: #1a3c6e; }
  .party p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  thead th {
    background: #1a3c6e;
    color: #fff;
    padding: 8px 10px;
    font-size: 12px;
    text-align: start;
  }
  tbody td { padding: 8px 10px; border-bottom: 1px solid #e2e6ec; font-size: 12.5px; }
  td.idx { width: 28px; color: #888; }
  td.num { text-align: start; white-space: nowrap; }
  td.strong { font-weight: 700; }
  .desc-sub { color: #777; font-size: 11px; margin-top: 2px; }
  .totals { display: flex; justify-content: flex-start; margin-bottom: 20px; }
  .totals table { width: 260px; margin: 0; }
  .totals td { padding: 6px 10px; border: none; }
  .totals .grand td { font-size: 15px; font-weight: 700; border-top: 2px solid #1a3c6e; }
  .terms { margin-bottom: 24px; }
  .terms h3 { font-size: 12.5px; color: #1a3c6e; margin: 0 0 4px; }
  .terms p { margin: 0 0 12px; font-size: 12px; color: #333; white-space: pre-wrap; }
  .footer { display: flex; justify-content: space-between; gap: 24px; margin-top: 30px; }
  .sign-box { flex: 1; text-align: center; }
  .sign-label { font-size: 12px; color: #555; margin: 0 0 8px; }
  .sign-line { border-bottom: 1px solid #999; height: 50px; }
  .sign-img { max-height: 70px; max-width: 220px; }
  .sign-meta { font-size: 11px; color: #666; margin-top: 6px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company-name">${esc(data.companyInfo.name)}</div>
      <div class="company-meta">
        ${esc(data.companyInfo.address)}<br/>
        ${esc(data.companyInfo.phone)} ${data.companyInfo.email ? "· " + esc(data.companyInfo.email) : ""}
      </div>
    </div>
    <div class="doc-title">
      <h1>عرض سعر ${esc(data.quoteNumber)}</h1>
      <p>الإصدار ${data.versionNumber}</p>
      <p>التاريخ: ${dateFmt.format(data.createdAt)}</p>
      ${data.validUntil ? `<p>صالح حتى: ${dateFmt.format(new Date(data.validUntil))}</p>` : ""}
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>بيانات العميل</h3>
      <p>${esc(data.customerName)}</p>
      ${data.customerPhone ? `<p dir="ltr" style="text-align:end">${esc(data.customerPhone)}</p>` : ""}
      ${data.customerAddress ? `<p>${esc(data.customerAddress)}</p>` : ""}
    </div>
    <div class="party">
      <h3>بيانات المهمة</h3>
      <p>${esc(data.jobNumber)}</p>
      ${data.jobTitle ? `<p>${esc(data.jobTitle)}</p>` : ""}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="idx">#</th>
        <th>الوصف</th>
        <th>الكمية</th>
        <th>سعر الوحدة</th>
        <th>الإجمالي</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>المجموع الفرعي</td><td class="num">${formatILS(data.subtotal)}</td></tr>
      <tr class="grand"><td>الإجمالي</td><td class="num">${formatILS(data.total)}</td></tr>
    </table>
  </div>

  ${
    data.paymentTerms || data.workTerms
      ? `<div class="terms">
    ${data.paymentTerms ? `<h3>شروط الدفع</h3><p>${esc(data.paymentTerms)}</p>` : ""}
    ${data.workTerms ? `<h3>شروط العمل</h3><p>${esc(data.workTerms)}</p>` : ""}
  </div>`
      : ""
  }

  <div class="footer">
    ${signatureBlock}
  </div>
</body>
</html>`;
}
