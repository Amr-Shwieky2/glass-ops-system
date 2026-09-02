"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { ShieldOff, ShieldCheck } from "lucide-react";
import { setUserStatusAction } from "@/server/users/actions";
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
import { Button } from "@/components/ui/button";

/**
 * Suspending a user is meaningful (they lose access on their very next
 * request — see setUserStatusAction's doc comment), so this is gated
 * behind an AlertDialog confirmation, same shape as ConfirmRemoveButton.
 */
export function StatusToggleButton({
  userId,
  currentStatus,
}: {
  userId: string;
  currentStatus: "active" | "suspended";
}) {
  const [isPending, startTransition] = useTransition();
  const nextStatus = currentStatus === "active" ? "suspended" : "active";
  const isSuspending = nextStatus === "suspended";

  function onConfirm() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("status", nextStatus);
      const result = await setUserStatusAction(userId, {}, formData);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(isSuspending ? "تم إيقاف المستخدم." : "تم تفعيل المستخدم.");
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={isSuspending ? "destructive" : "outline"}
          disabled={isPending}
        >
          {isSuspending ? (
            <ShieldOff className="size-4" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
          {isSuspending ? "إيقاف المستخدم" : "تفعيل المستخدم"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isSuspending ? "إيقاف المستخدم؟" : "تفعيل المستخدم؟"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSuspending
              ? "لن يتمكن هذا المستخدم من تسجيل الدخول أو استخدام النظام بعد الإيقاف مباشرة."
              : "سيتمكن هذا المستخدم من تسجيل الدخول واستخدام النظام مرة أخرى."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={onConfirm}>
            {isSuspending ? "إيقاف" : "تفعيل"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
