"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Send } from "lucide-react";
import { submitFactoryPriceAction } from "@/server/production/actions";
import type { ActionState } from "@/server/production/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      <Send className="size-4" />
      {pending ? "جارٍ الإرسال..." : "إرسال السعر"}
    </Button>
  );
}

export function SubmitForm({ token }: { token: string }) {
  const action = submitFactoryPriceAction.bind(null, token);
  const [state, formAction] = useActionState(action, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">إرسال السعر</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="submittedPrice">السعر *</Label>
            <Input
              id="submittedPrice"
              name="submittedPrice"
              inputMode="decimal"
              dir="ltr"
              required
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="estimatedReadyDate">تاريخ الجاهزية المتوقع (اختياري)</Label>
            <Input id="estimatedReadyDate" name="estimatedReadyDate" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات (اختياري)</Label>
            <Textarea id="notes" name="notes" rows={3} placeholder="نوع الزجاج، السماكة..." />
          </div>

          {state.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}

          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  );
}
