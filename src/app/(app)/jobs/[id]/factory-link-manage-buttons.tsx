"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Ban, RefreshCw, Copy, Check } from "lucide-react";
import {
  revokeFactoryLinkAction,
  regenerateFactoryLinkAction,
} from "@/server/production/actions";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** CREATE_PRODUCTION_ORDER-only — revoke the current factory public link,
 * or regenerate a fresh one (Sprint 7, S7.5). Revoking alone leaves the
 * job with no active link at all (staff must regenerate or resend
 * manually); regenerating revokes the old one and immediately shows the
 * new one, mirroring SendToFactoryDialog's own link-reveal. `linkId` is
 * null when there is no currently active link (already revoked/expired) —
 * the "إلغاء الرابط" button only renders when there's something to
 * revoke; "إصدار رابط جديد" always renders. */
export function FactoryLinkManageButtons({
  jobId,
  linkId,
  productionRequestId,
}: {
  jobId: string;
  linkId: string | null;
  productionRequestId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [newLink, setNewLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    if (!newLink) return;
    navigator.clipboard.writeText(newLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {linkId && (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
            <Ban className="size-4" />
            إلغاء الرابط
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء رابط المصنع</AlertDialogTitle>
            <AlertDialogDescription>
              لن يتمكن المصنع من استخدام هذا الرابط بعد الآن. يمكنك إصدار رابط جديد لاحقاً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await revokeFactoryLinkAction(jobId, linkId);
                  if (result.error) toast.error(result.error);
                  else toast.success("تم إلغاء الرابط.");
                });
              }}
            >
              تأكيد الإلغاء
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      )}

      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const result = await regenerateFactoryLinkAction(jobId, productionRequestId);
            if (result.error) {
              toast.error(result.error);
            } else if (result.publicPath) {
              setNewLink(`${window.location.origin}${result.publicPath}`);
              toast.success("تم إصدار رابط جديد.");
            }
          });
        }}
      >
        <RefreshCw className="size-4" />
        إصدار رابط جديد
      </Button>

      <Dialog open={newLink !== null} onOpenChange={(open) => !open && setNewLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>الرابط الجديد لطلب الإنتاج</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly dir="ltr" value={newLink ?? ""} />
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
          <DialogFooter>
            <Button type="button" onClick={() => setNewLink(null)}>
              تم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
