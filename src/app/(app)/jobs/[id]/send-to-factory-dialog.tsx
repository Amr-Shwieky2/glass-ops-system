"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Factory, Copy, Check } from "lucide-react";
import { sendToFactoryAction, type SendToFactoryState } from "@/server/production/actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const initialState: SendToFactoryState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الإرسال..." : "إرسال إلى المصنع"}
    </Button>
  );
}

/** Creating a production request IS sending it (factory_status has no
 * 'draft' value, see the schema) — one form, and success immediately
 * reveals the factory's public link in the same dialog, mirroring
 * SendQuoteButton's link-reveal (but here the link only exists once this
 * form's details are captured, so it's one dialog instead of two).
 *
 * `hasRequest` (a request already exists for this job) must NOT gate
 * whether this component is mounted at all — the parent always renders
 * it. If the parent instead only rendered it while `!hasRequest`, the
 * very success this component produces (a new request) would flip
 * `hasRequest` true on the SAME re-render as the action's own result,
 * unmounting this component (and wiping the useActionState link it was
 * about to show) before the user ever saw it. Instead this component
 * decides for itself: render nothing once a request exists UNLESS it is
 * this instance's own submission currently being shown. */
export function SendToFactoryDialog({
  jobId,
  defaultDetails,
  hasRequest,
}: {
  jobId: string;
  defaultDetails?: string;
  hasRequest: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const action = sendToFactoryAction.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);
  const [copied, setCopied] = React.useState(false);

  const link = state.publicPath
    ? typeof window !== "undefined"
      ? `${window.location.origin}${state.publicPath}`
      : state.publicPath
    : null;
  const showingOwnSuccess = open && link !== null;

  function handleCopy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (hasRequest && !showingOwnSuccess) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Factory className="size-4" />
          إرسال إلى المصنع
        </Button>
      </DialogTrigger>
      <DialogContent>
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>تم إنشاء طلب الإنتاج</DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly dir="ltr" value={link} />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopy}
                aria-label="نسخ الرابط"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              شارك هذا الرابط مع المصنع ليتمكن من إرسال السعر وموعد الجاهزية دون الحاجة لحساب
              دخول.
            </p>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                تم
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>إرسال المهمة إلى المصنع</DialogTitle>
            </DialogHeader>
            <form action={formAction} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="details">تفاصيل الطلب *</Label>
                <Textarea
                  id="details"
                  name="details"
                  rows={4}
                  required
                  defaultValue={defaultDetails}
                  placeholder="الأبعاد ونوع الزجاج المطلوب من المصنع..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estimatedReadyDate">تاريخ الجاهزية المتوقع (اختياري)</Label>
                <Input id="estimatedReadyDate" name="estimatedReadyDate" type="date" />
              </div>
              {state.error && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {state.error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  إلغاء
                </Button>
                <SubmitButton />
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
