"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound } from "lucide-react";
import { resetUserPasswordAction, type ActionState } from "@/server/users/actions";
import { useCloseOnSuccess } from "@/lib/use-close-on-success";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const initialState: ActionState = {};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "جارٍ الحفظ..." : "إعادة تعيين"}
    </Button>
  );
}

export function ResetPasswordDialog({ userId }: { userId: string }) {
  const [open, setOpen] = React.useState(false);
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const action = resetUserPasswordAction.bind(null, userId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setNewPassword("");
          setConfirmPassword("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <KeyRound className="size-4" />
          إعادة تعيين كلمة المرور
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إعادة تعيين كلمة المرور</DialogTitle>
          <DialogDescription>
            سيتم إلغاء جميع جلسات الدخول الحالية لهذا المستخدم — سيحتاج لتسجيل الدخول من
            جديد بكلمة المرور الجديدة.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="newPassword">كلمة المرور الجديدة *</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              dir="ltr"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">8 أحرف على الأقل.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">تأكيد كلمة المرور *</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              dir="ltr"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {mismatch && (
              <p role="alert" className="text-sm font-medium text-destructive">
                كلمتا المرور غير متطابقتين.
              </p>
            )}
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
            <SubmitButton disabled={mismatch} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
