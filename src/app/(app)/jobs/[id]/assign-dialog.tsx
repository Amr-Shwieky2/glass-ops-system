"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { assignToJob, type ActionState } from "@/server/jobs/actions";
import { useCloseOnSuccess } from "@/lib/use-close-on-success";
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

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "تعيين"}
    </Button>
  );
}

const WHOLE_JOB_VALUE = "__whole_job__";

export function AssignDialog({
  jobId,
  assignableUsers,
  externalContractors,
  jobItems = [],
}: {
  jobId: string;
  assignableUsers: { id: string; name: string }[];
  externalContractors: { id: string; name: string }[];
  /** Sprint 7 (R1.22) — when the job has line items, lets this assignment
   * target one specific item instead of the whole job. Optional/omittable
   * for callers with no items to offer; defaults to whole-job either way. */
  jobItems?: { id: string; label: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"user" | "contractor">("user");
  const [jobItemId, setJobItemId] = React.useState<string>(WHOLE_JOB_VALUE);
  const action = assignToJob.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          تعيين فني
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعيين فني على المهمة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("user")}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium",
                mode === "user"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input text-muted-foreground",
              )}
            >
              فني داخلي
            </button>
            <button
              type="button"
              onClick={() => setMode("contractor")}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium",
                mode === "contractor"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input text-muted-foreground",
              )}
            >
              مقاول خارجي
            </button>
          </div>

          {mode === "user" ? (
            <div className="space-y-2">
              <Label htmlFor="userId">الفني *</Label>
              <Select name="userId" required>
                <SelectTrigger id="userId">
                  <SelectValue placeholder="اختر فنياً" />
                </SelectTrigger>
                <SelectContent>
                  {assignableUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="externalContractorId">المقاول *</Label>
              <Select name="externalContractorId" required>
                <SelectTrigger id="externalContractorId">
                  <SelectValue placeholder="اختر مقاولاً" />
                </SelectTrigger>
                <SelectContent>
                  {externalContractors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {jobItems.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="jobItemId">التعيين على (اختياري)</Label>
              <Select value={jobItemId} onValueChange={setJobItemId}>
                <SelectTrigger id="jobItemId">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WHOLE_JOB_VALUE}>المهمة كاملة</SelectItem>
                  {jobItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {jobItemId !== WHOLE_JOB_VALUE && (
                <input type="hidden" name="jobItemId" value={jobItemId} />
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="role">الدور (اختياري)</Label>
            <Input id="role" name="role" placeholder="تركيب / مساعدة" />
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
      </DialogContent>
    </Dialog>
  );
}
