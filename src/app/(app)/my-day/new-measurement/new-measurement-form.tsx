"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitFieldMeasurementAction, type ActionState } from "@/server/measurements/actions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const initialState: ActionState = {};

// Mirrors the fixed constants in src/server/storage/attachments.ts
// (MAX_ATTACHMENT_SIZE_BYTES / MAX_ATTACHMENTS_PER_SUBMISSION) — duplicated
// here only for fast client-side feedback per spec section 5; the server
// action re-validates every file itself and is the only authoritative
// check. Keep these two in sync if the server-side limits ever change.
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 5;

// Mirrors ALLOWED_IMAGE_MIME_TYPES in src/server/storage/attachments.ts —
// raster types only, deliberately narrower than a blanket `image/*`.
// `image/svg+xml` is a script-capable document format, not a pixel
// format, and must never be added here or accepted client-side even
// though the server re-validates authoritatively: the server-side reject
// message is generic, so allowing it through here first would just cost
// the user an extra round trip to learn "not supported" for a type we
// already know we'll refuse.
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/bmp",
]);

/** SessionStorage key the job detail page's success-toast component looks
 * for after the server action's redirect lands (see field-measurement-
 * success-toast.tsx for why a plain useActionState `success` flag can't
 * carry this — a redirecting Server Action never returns state.success). */
const SUBMITTED_FLAG_KEY = "fieldMeasurementSubmittedAt";

function isAllowedFile(file: File): boolean {
  return file.type === "application/pdf" || ALLOWED_IMAGE_MIME_TYPES.has(file.type);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

/** Validates a FileList against the fixed count/size/type limits, purely
 * client-side, for immediate feedback before the user even taps submit.
 * Returns an Arabic error naming the offending file, or null. */
function validateFilesClientSide(files: File[]): string | null {
  if (files.length === 0) return "يجب إرفاق صورة واحدة على الأقل.";
  if (files.length > MAX_FILES) return `يمكن إرفاق ${MAX_FILES} ملفات كحد أقصى.`;
  for (const file of files) {
    if (!isAllowedFile(file)) {
      return `نوع الملف "${file.name}" غير مدعوم. يُسمح فقط بالصور وملفات PDF.`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `حجم الملف "${file.name}" يتجاوز الحد المسموح (15 ميجابايت).`;
    }
  }
  return null;
}

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending || disabled}>
      {pending ? "جارٍ الإرسال..." : "إرسال القياس"}
    </Button>
  );
}

export function NewMeasurementForm({
  glassTypes,
}: {
  glassTypes: { id: string; labelAr: string }[];
}) {
  const [state, formAction] = useActionState(submitFieldMeasurementAction, initialState);

  const [selectedFiles, setSelectedFiles] = React.useState<File[]>([]);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [priceValue, setPriceValue] = React.useState("");
  const [priceIncludesVat, setPriceIncludesVat] = React.useState<"true" | "false" | null>(null);

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setSelectedFiles(files);
    setFileError(files.length > 0 ? validateFilesClientSide(files) : null);
  }

  const hasPrice = priceValue.trim().length > 0;

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={(e) => {
        // A blocking client-side file error (fast feedback per spec
        // section 5) stops the submission before it ever reaches the
        // server action.
        if (fileError) {
          e.preventDefault();
          return;
        }
        // See SUBMITTED_FLAG_KEY's own comment — the action redirects on
        // success, so this is how the job detail page knows to show a
        // success toast once it lands there.
        try {
          sessionStorage.setItem(SUBMITTED_FLAG_KEY, String(Date.now()));
        } catch {
          // Private browsing / storage disabled — the toast is a nicety,
          // never block the actual submission over it.
        }
      }}
      className="space-y-4"
    >
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="phone">رقم هاتف العميل *</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoFocus
              required
              className="text-lg font-medium"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customerName">اسم العميل (اختياري)</Label>
            <Input id="customerName" name="customerName" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="glassTypeId">نوع الزجاج (اختياري)</Label>
            <Select name="glassTypeId">
              <SelectTrigger id="glassTypeId">
                <SelectValue placeholder="اختر نوع الزجاج" />
              </SelectTrigger>
              <SelectContent>
                {glassTypes.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.labelAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <Label htmlFor="files">صور / ملفات القياس * (١ حتى {MAX_FILES}، صور أو PDF)</Label>
          <Input
            id="files"
            name="files"
            type="file"
            accept="image/*,application/pdf"
            multiple
            required
            onChange={handleFilesChange}
          />
          {selectedFiles.length > 0 && !fileError && (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {selectedFiles.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <span dir="ltr" className="shrink-0">{formatFileSize(f.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {fileError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {fileError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات (اختياري)</Label>
            <Textarea id="notes" name="notes" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">سعر تقديري من الموقع (اختياري)</Label>
            <Input
              id="price"
              name="price"
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={priceValue}
              onChange={(e) => setPriceValue(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              هذا السعر مرجعي فقط لفريق التسعير، وليس عرض سعر ملزم للعميل.
            </p>
          </div>

          {hasPrice && (
            <div className="space-y-2">
              <Label>هل السعر شامل الضريبة؟ *</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPriceIncludesVat("false")}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium",
                    priceIncludesVat === "false"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input text-muted-foreground",
                  )}
                >
                  قبل الضريبة
                </button>
                <button
                  type="button"
                  onClick={() => setPriceIncludesVat("true")}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium",
                    priceIncludesVat === "true"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input text-muted-foreground",
                  )}
                >
                  شامل الضريبة
                </button>
              </div>
              <input type="hidden" name="priceIncludesVat" value={priceIncludesVat ?? ""} />
            </div>
          )}
        </CardContent>
      </Card>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      )}

      <SubmitButton disabled={hasPrice && priceIncludesVat === null} />
    </form>
  );
}
