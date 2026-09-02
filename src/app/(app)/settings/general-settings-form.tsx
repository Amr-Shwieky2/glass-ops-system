"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import {
  updateGeneralSettingsAction,
  type ActionState,
} from "@/server/settings-actions";
import type { SettingsSchema } from "@/server/settings-defaults";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "حفظ الإعدادات العامة"}
    </Button>
  );
}

/**
 * One form covering the entire application_settings schema (section 77),
 * calling updateGeneralSettingsAction in one submit — matches the backend
 * report's "one form / one submit" design (it merges sub-object fields
 * against the existing row itself, so a partial edit here never wipes a
 * sibling field). Pre-filled from getAllSettings() by the server page.
 */
export function GeneralSettingsForm({ settings }: { settings: SettingsSchema }) {
  const [state, formAction] = useActionState(updateGeneralSettingsAction, initialState);
  const prevState = React.useRef(state);
  if (prevState.current !== state) {
    prevState.current = state;
    if (state.success) toast.success("تم حفظ الإعدادات العامة.");
  }

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>القواعد المالية</CardTitle>
          <CardDescription>
            تُستخدم هذه القيم في حساب العمولات وصلاحية عروض الأسعار وخصم استخدام المركبات.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="commissionRatePercent">نسبة العمولة (%) *</Label>
            <Input
              id="commissionRatePercent"
              name="commissionRatePercent"
              type="text"
              inputMode="decimal"
              dir="ltr"
              defaultValue={settings.commission_rate_percent}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quoteValidityDays">مدة صلاحية عرض السعر (بالأيام) *</Label>
            <Input
              id="quoteValidityDays"
              name="quoteValidityDays"
              type="text"
              inputMode="numeric"
              dir="ltr"
              defaultValue={settings.quote_validity_days}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vehicleUsageDeductionDefault">
              خصم استخدام المركبة الافتراضي (₪) *
            </Label>
            <Input
              id="vehicleUsageDeductionDefault"
              name="vehicleUsageDeductionDefault"
              type="text"
              inputMode="decimal"
              dir="ltr"
              defaultValue={settings.vehicle_usage_deduction_default}
              required
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>حدود التنبيهات</CardTitle>
          <CardDescription>
            تتحكم هذه القيم بتوقيت التذكيرات والتنبيهات التلقائية في النظام.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="measurementReminderMinutesBefore">
              التذكير بموعد القياس قبله بـ (دقيقة) *
            </Label>
            <p className="text-xs text-muted-foreground">
              كم دقيقة قبل موعد القياس المجدوَل يُرسَل تذكير للفني المسؤول.
            </p>
            <Input
              id="measurementReminderMinutesBefore"
              name="measurementReminderMinutesBefore"
              type="text"
              inputMode="numeric"
              dir="ltr"
              defaultValue={settings.notification_thresholds.measurementReminderMinutesBefore}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="installationReminderHoursBefore">
              التذكير بموعد التركيب قبله بـ (ساعة) *
            </Label>
            <p className="text-xs text-muted-foreground">
              كم ساعة قبل موعد التركيب المجدوَل يُرسَل تذكير للفني المسؤول.
            </p>
            <Input
              id="installationReminderHoursBefore"
              name="installationReminderHoursBefore"
              type="text"
              inputMode="numeric"
              dir="ltr"
              defaultValue={settings.notification_thresholds.installationReminderHoursBefore}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="checkDueSoonDays">تنبيه استحقاق الشيك قبله بـ (يوم) *</Label>
            <p className="text-xs text-muted-foreground">
              كم يوماً قبل تاريخ استحقاق الشيك يظهر تنبيه بأنه على وشك الاستحقاق.
            </p>
            <Input
              id="checkDueSoonDays"
              name="checkDueSoonDays"
              type="text"
              inputMode="numeric"
              dir="ltr"
              defaultValue={settings.notification_thresholds.checkDueSoonDays}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staleRepairDays">تنبيه تأخر الإصلاح بعد (يوم) *</Label>
            <p className="text-xs text-muted-foreground">
              كم يوماً بلا تحديث على طلب الإصلاح قبل اعتباره متأخراً وتنبيه المسؤول عنه.
            </p>
            <Input
              id="staleRepairDays"
              name="staleRepairDays"
              type="text"
              inputMode="numeric"
              dir="ltr"
              defaultValue={settings.notification_thresholds.staleRepairDays}
              required
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>بيانات الشركة</CardTitle>
          <CardDescription>تظهر هذه البيانات على عروض الأسعار المرسلة للعملاء.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="companyName">اسم الشركة *</Label>
            <Input
              id="companyName"
              name="companyName"
              defaultValue={settings.company_info.name}
              required
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="companyAddress">العنوان</Label>
            <Input
              id="companyAddress"
              name="companyAddress"
              defaultValue={settings.company_info.address}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="companyPhone">هاتف الشركة</Label>
            <Input
              id="companyPhone"
              name="companyPhone"
              dir="ltr"
              defaultValue={settings.company_info.phone}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="companyEmail">البريد الإلكتروني للشركة</Label>
            <Input
              id="companyEmail"
              name="companyEmail"
              type="email"
              dir="ltr"
              defaultValue={settings.company_info.email}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="companyTaxId">الرقم الضريبي</Label>
            <Input
              id="companyTaxId"
              name="companyTaxId"
              dir="ltr"
              defaultValue={settings.company_info.taxId}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>الشروط الافتراضية لعرض السعر</CardTitle>
          <CardDescription>تظهر هذه الشروط في أسفل كل عرض سعر جديد.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <div className="space-y-2">
            <Label htmlFor="quotePaymentTerms">شروط الدفع *</Label>
            <Textarea
              id="quotePaymentTerms"
              name="quotePaymentTerms"
              rows={3}
              defaultValue={settings.quote_default_terms.paymentTerms}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quoteWorkTerms">شروط العمل *</Label>
            <Textarea
              id="quoteWorkTerms"
              name="quoteWorkTerms"
              rows={3}
              defaultValue={settings.quote_default_terms.workTerms}
              required
            />
          </div>
        </CardContent>
      </Card>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
