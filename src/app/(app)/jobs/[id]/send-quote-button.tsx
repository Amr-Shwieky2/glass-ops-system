"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Send, Copy, Check } from "lucide-react";
import { sendQuoteAction } from "@/server/quotes/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function SendQuoteButton({
  jobId,
  quoteId,
  customerPhone,
  label = "إرسال للعميل",
}: {
  jobId: string;
  quoteId: string;
  customerPhone?: string | null;
  label?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [link, setLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  function handleSend() {
    startTransition(async () => {
      const result = await sendQuoteAction(jobId, quoteId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.publicPath) {
        setLink(`${window.location.origin}${result.publicPath}`);
      }
    });
  }

  function handleCopy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const whatsappHref = link
    ? `https://wa.me/${(customerPhone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(
        `مرحباً، هذا رابط عرض السعر الخاص بكم:\n${link}`,
      )}`
    : "#";

  return (
    <>
      <Button size="sm" onClick={handleSend} disabled={isPending}>
        <Send className="size-4" />
        {isPending ? "جارٍ الإرسال..." : label}
      </Button>
      <Dialog open={link !== null} onOpenChange={(open) => !open && setLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رابط توقيع العرض جاهز</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly dir="ltr" value={link ?? ""} />
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
            شارك هذا الرابط مع العميل ليتمكن من مراجعة العرض والتوقيع عليه إلكترونياً.
          </p>
          {customerPhone && (
            <DialogFooter>
              <Button asChild variant="secondary">
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                  مشاركة عبر واتساب
                </a>
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
