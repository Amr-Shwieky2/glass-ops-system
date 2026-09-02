"use client";

import * as React from "react";
import { Link2, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Re-displays an already-issued factory public link (the link itself was
 * only shown once, at creation time, inside SendToFactoryDialog) — the
 * production-request equivalent of the quote section's "resend / show
 * link" affordance. No server call: the token is already known. */
export function ShowFactoryLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = React.useState(false);
  const link =
    typeof window !== "undefined" ? `${window.location.origin}/public/pr/${token}` : "";

  function handleCopy() {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Link2 className="size-4" />
          رابط المصنع
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>رابط تقديم سعر المصنع</DialogTitle>
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
      </DialogContent>
    </Dialog>
  );
}
