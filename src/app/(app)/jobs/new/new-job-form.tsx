"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createJob, type ActionState } from "@/server/jobs/actions";
import { CustomerCombobox } from "../customer-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? "جارٍ الإنشاء..." : "إنشاء المهمة"}
    </Button>
  );
}

export function NewJobForm({
  preselectedCustomer,
}: {
  preselectedCustomer?: { id: string; name: string; phone: string; address: string | null } | null;
}) {
  const [state, formAction] = useActionState(createJob, initialState);
  const [mode, setMode] = React.useState<"existing" | "new">(
    preselectedCustomer ? "existing" : "existing",
  );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className={cn(
                "rounded-md border px-4 py-2 text-sm font-medium",
                mode === "existing"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input text-muted-foreground",
              )}
            >
              عميل موجود
            </button>
            <button
              type="button"
              onClick={() => setMode("new")}
              className={cn(
                "rounded-md border px-4 py-2 text-sm font-medium",
                mode === "new"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input text-muted-foreground",
              )}
            >
              عميل جديد
            </button>
          </div>

          {mode === "existing" ? (
            <div className="space-y-2">
              <Label>العميل *</Label>
              <CustomerCombobox name="customerId" initial={preselectedCustomer} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="newCustomerName">اسم العميل *</Label>
                <Input id="newCustomerName" name="newCustomerName" required={mode === "new"} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newCustomerPhone">رقم الهاتف *</Label>
                <Input
                  id="newCustomerPhone"
                  name="newCustomerPhone"
                  type="tel"
                  dir="ltr"
                  required={mode === "new"}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <Label htmlFor="title">عنوان المهمة</Label>
            <Input id="title" name="title" placeholder="مثال: تركيب زجاج مطبخ" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">العنوان (اتركه فارغاً لاستخدام عنوان العميل)</Label>
            <Input id="address" name="address" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات</Label>
            <Textarea id="notes" name="notes" />
          </div>
        </CardContent>
      </Card>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
