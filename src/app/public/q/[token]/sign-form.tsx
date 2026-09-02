"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { PenLine } from "lucide-react";
import { signQuotePublicly, type ActionState } from "@/server/quotes/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { SignaturePad } from "@/components/signature-pad";

const initialState: ActionState = {};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={disabled || pending}>
      <PenLine className="size-4" />
      {pending ? "جارٍ الحفظ..." : "توقيع والموافقة على العرض"}
    </Button>
  );
}

export function SignForm({
  token,
  defaultName,
  defaultPhone,
  defaultAddress,
}: {
  token: string;
  defaultName: string;
  defaultPhone: string;
  defaultAddress: string;
}) {
  const action = signQuotePublicly.bind(null, token);
  const [state, formAction] = useActionState(action, initialState);
  const [signature, setSignature] = React.useState<string | null>(null);
  const [agreed, setAgreed] = React.useState(false);
  const [coords, setCoords] = React.useState<{ lat: string; lng: string } | null>(null);

  React.useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: String(pos.coords.latitude), lng: String(pos.coords.longitude) }),
      () => {
        /* denied or unavailable — signing proceeds without it */
      },
      { timeout: 5000 },
    );
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">التوقيع والموافقة</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="signatureImage" value={signature ?? ""} />
          <input type="hidden" name="latitude" value={coords?.lat ?? ""} />
          <input type="hidden" name="longitude" value={coords?.lng ?? ""} />

          <div className="space-y-2">
            <Label htmlFor="customerNameAtSigning">الاسم</Label>
            <Input
              id="customerNameAtSigning"
              name="customerNameAtSigning"
              defaultValue={defaultName}
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="customerPhoneAtSigning">رقم الهاتف</Label>
              <Input
                id="customerPhoneAtSigning"
                name="customerPhoneAtSigning"
                dir="ltr"
                defaultValue={defaultPhone}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerNationalIdAtSigning">رقم الهوية (اختياري)</Label>
              <Input id="customerNationalIdAtSigning" name="customerNationalIdAtSigning" dir="ltr" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customerAddressAtSigning">العنوان</Label>
            <Textarea
              id="customerAddressAtSigning"
              name="customerAddressAtSigning"
              defaultValue={defaultAddress}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>التوقيع</Label>
            <SignaturePad onChange={setSignature} />
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="agreedToTerms"
              name="agreedToTerms"
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              required
              className="mt-0.5"
            />
            <Label htmlFor="agreedToTerms" className="font-normal leading-snug">
              أوافق على بنود عرض السعر وشروط الدفع والعمل الموضحة أعلاه.
            </Label>
          </div>

          {state.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}

          <SubmitButton disabled={!signature || !agreed} />
        </form>
      </CardContent>
    </Card>
  );
}
