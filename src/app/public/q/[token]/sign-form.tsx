"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { PenLine } from "lucide-react";
import { signQuotePublicly, type ActionState } from "@/server/quotes/actions";
import { getQuoteLabels, type QuoteLanguage } from "@/lib/quote-i18n";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { SignaturePad } from "@/components/signature-pad";

const initialState: ActionState = {};

// Returning-customer convenience only — never the address (the customer is
// expected to re-confirm/update the installation address on every quote,
// not silently reuse a stale one). Namespaced and versioned so a future
// shape change can invalidate old entries cleanly. Private to this origin's
// browser storage — never sent anywhere, never read server-side.
const PROFILE_STORAGE_KEY = "glassops.publicQuoteSign.customerProfile.v1";

interface StoredCustomerProfile {
  name: string;
  phone: string;
  idNumber: string;
}

function readStoredProfile(): StoredCustomerProfile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { name, phone, idNumber } = parsed as Record<string, unknown>;
    return {
      name: typeof name === "string" ? name : "",
      phone: typeof phone === "string" ? phone : "",
      idNumber: typeof idNumber === "string" ? idNumber : "",
    };
  } catch {
    // Private browsing, disabled storage, corrupted JSON, etc. — signing
    // must keep working with no prefill.
    return null;
  }
}

function writeStoredProfile(profile: StoredCustomerProfile): void {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage unavailable — the signature itself already saved server-side,
    // so this is a silently-skipped convenience, not a failure.
  }
}

function SubmitButton({
  disabled,
  idleLabel,
  pendingLabel,
}: {
  disabled: boolean;
  idleLabel: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={disabled || pending}>
      <PenLine className="size-4" />
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}

export function SignForm({
  token,
  language,
  defaultName,
  defaultPhone,
  defaultAddress,
}: {
  token: string;
  language: QuoteLanguage;
  defaultName: string;
  defaultPhone: string;
  defaultAddress: string;
}) {
  const labels = getQuoteLabels(language);
  const action = signQuotePublicly.bind(null, token);
  const [state, formAction] = useActionState(action, initialState);
  const [signature, setSignature] = React.useState<string | null>(null);
  const [agreed, setAgreed] = React.useState(false);
  const [coords, setCoords] = React.useState<{ lat: string; lng: string } | null>(null);

  // Fields prefilled from the customer record on the server AND, once
  // mounted, overlaid with any locally-remembered profile from a previous
  // signing on this device — always left fully editable either way.
  const [name, setName] = React.useState(defaultName);
  const [phone, setPhone] = React.useState(defaultPhone);
  const [idNumber, setIdNumber] = React.useState("");

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

  React.useEffect(() => {
    const stored = readStoredProfile();
    if (!stored) return;
    if (stored.name) setName(stored.name);
    if (stored.phone) setPhone(stored.phone);
    if (stored.idNumber) setIdNumber(stored.idNumber);
    // Runs once on mount, for this quote's fresh sign page only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!state.success) return;
    writeStoredProfile({ name: name.trim(), phone: phone.trim(), idNumber: idNumber.trim() });
    // Only re-run when the action transitions to success.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{labels.signingForm.formTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="signatureImage" value={signature ?? ""} />
          <input type="hidden" name="latitude" value={coords?.lat ?? ""} />
          <input type="hidden" name="longitude" value={coords?.lng ?? ""} />

          <div className="space-y-2">
            <Label htmlFor="customerNameAtSigning">{labels.signingForm.fullNameLabel}</Label>
            <Input
              id="customerNameAtSigning"
              name="customerNameAtSigning"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="customerPhoneAtSigning">{labels.signingForm.phoneLabel}</Label>
              <Input
                id="customerPhoneAtSigning"
                name="customerPhoneAtSigning"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerNationalIdAtSigning">
                {labels.signingForm.nationalIdLabel}
              </Label>
              <Input
                id="customerNationalIdAtSigning"
                name="customerNationalIdAtSigning"
                dir="ltr"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customerAddressAtSigning">{labels.signingForm.addressLabel}</Label>
            <Textarea
              id="customerAddressAtSigning"
              name="customerAddressAtSigning"
              defaultValue={defaultAddress}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>{labels.signingForm.signaturePadLabel}</Label>
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
              {labels.signingForm.agreementText}
            </Label>
          </div>

          {state.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}

          <SubmitButton
            disabled={!signature || !agreed}
            idleLabel={labels.signingForm.submitLabel}
            pendingLabel={labels.signingForm.submitPendingLabel}
          />
        </form>
      </CardContent>
    </Card>
  );
}
