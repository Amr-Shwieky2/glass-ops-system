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
// not silently reuse a stale one). Namespaced PER CUSTOMER (see
// profileStorageKey below) and versioned so a future shape change can
// invalidate old entries cleanly. Private to this origin's browser storage
// — never sent anywhere, never read server-side.
//
// IMPORTANT: this key MUST be scoped by customerId, not a single global
// key. A public signing link is opened on shared/office devices as often
// as personal ones, and this cache holds the "legal fields"
// (name/phone/national-ID) that get written verbatim into the signature
// record. A global key would prefill one customer's legal identity into a
// completely different customer's signing form the next time that browser
// opens a different quote's link — see the v1 bug this replaced. Keying by
// customerId means the autofill only ever fires for the SAME customer
// signing a later quote of their own.
const PROFILE_STORAGE_PREFIX = "glassops.publicQuoteSign.customerProfile.v2.";

function profileStorageKey(customerId: string): string {
  return `${PROFILE_STORAGE_PREFIX}${customerId}`;
}

interface StoredCustomerProfile {
  name: string;
  phone: string;
  idNumber: string;
}

function readStoredProfile(customerId: string | null): StoredCustomerProfile | null {
  if (!customerId) return null;
  try {
    const raw = window.localStorage.getItem(profileStorageKey(customerId));
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

function writeStoredProfile(customerId: string | null, profile: StoredCustomerProfile): void {
  if (!customerId) return;
  try {
    window.localStorage.setItem(profileStorageKey(customerId), JSON.stringify(profile));
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
  customerId,
  defaultName,
  defaultPhone,
  defaultAddress,
}: {
  token: string;
  language: QuoteLanguage;
  /** The server-verified customer this quote actually belongs to — used
   * ONLY to namespace the local returning-customer cache (never sent
   * anywhere). Null when the quote has no linked customer record, in which
   * case the cache is skipped entirely rather than falling back to some
   * shared key. */
  customerId: string | null;
  defaultName: string;
  defaultPhone: string;
  defaultAddress: string;
}) {
  const labels = getQuoteLabels(language);
  const [signature, setSignature] = React.useState<string | null>(null);
  const [agreed, setAgreed] = React.useState(false);
  const [coords, setCoords] = React.useState<{ lat: string; lng: string } | null>(null);

  // Fields prefilled from the customer record on the server AND, once
  // mounted, overlaid with any locally-remembered profile from a previous
  // signing on this device — always left fully editable either way. Read
  // via lazy useState initializers (each runs exactly once, at this
  // component's first render) rather than a mount effect: on the server
  // (and on this component's very first client render before hydration
  // reconciles it) `window` doesn't exist, so readStoredProfile's own
  // try/catch simply yields null and these fall back to the server-supplied
  // defaults, same as before; this also sidesteps the extra post-mount
  // render a setState-in-effect would cost (react-hooks/set-state-in-effect
  // — same reasoning as src/lib/use-close-on-success.ts).
  const [name, setName] = React.useState(
    () => readStoredProfile(customerId)?.name || defaultName,
  );
  const [phone, setPhone] = React.useState(
    () => readStoredProfile(customerId)?.phone || defaultPhone,
  );
  const [idNumber, setIdNumber] = React.useState(
    () => readStoredProfile(customerId)?.idNumber || "",
  );

  // Wraps the server action so the "remember this profile for next time"
  // write happens as a plain side effect of the submit itself, not in a
  // useEffect keyed off `state.success`. On success this server action calls
  // revalidatePath, and Next.js folds the refreshed RSC payload into the
  // SAME transition that resolves useActionState — the parent Server
  // Component then renders the signed view in SignForm's place, unmounting
  // it in that same commit. A passive effect scheduled for that same
  // state.success update never gets to run because the fiber it would run
  // on is torn down first. Doing the write here, before this promise even
  // resolves back into React, sidesteps that race entirely.
  const action = React.useCallback(
    async (prevState: ActionState, formData: FormData) => {
      const result = await signQuotePublicly(token, prevState, formData);
      if (result.success) {
        writeStoredProfile(customerId, {
          name: String(formData.get("customerNameAtSigning") ?? "").trim(),
          phone: String(formData.get("customerPhoneAtSigning") ?? "").trim(),
          idNumber: String(formData.get("customerNationalIdAtSigning") ?? "").trim(),
        });
      }
      return result;
    },
    [token, customerId],
  );
  const [state, formAction] = useActionState(action, initialState);

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
                placeholder={labels.signingForm.nationalIdPlaceholder}
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
            <SignaturePad
              onChange={setSignature}
              clearLabel={labels.signingForm.clearSignatureLabel}
            />
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
