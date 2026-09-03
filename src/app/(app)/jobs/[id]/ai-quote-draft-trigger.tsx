"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  generateQuoteDraftAction,
  type QuoteDraftActionState,
} from "@/server/quotes/ai-draft-actions";
import type { DraftedQuote } from "@/server/ai/quote-generator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { QuoteBuilderDialog, type QuoteBuilderItem } from "./quote-builder-dialog";

const initialState: QuoteDraftActionState = {};

/** Local-model generation can take several seconds — a clearly-labelled
 * pending state so the dialog never reads as frozen while it waits. */
function GenerateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          جارٍ التوليد، قد يستغرق ذلك بضع ثوانٍ...
        </>
      ) : (
        "توليد"
      )}
    </Button>
  );
}

function draftToBuilderItems(draft: DraftedQuote): QuoteBuilderItem[] {
  return draft.items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
  }));
}

/**
 * Admin-facing trigger for AI-assisted quote drafting (draft-assist only —
 * see AGENTS.md and src/server/quotes/ai-draft-actions.ts). Shown next to
 * the existing manual "إنشاء عرض سعر" entry point, gated by the same
 * canCreateQuote check, no new permission.
 *
 * On a successful generation this closes its own small dialog and opens the
 * EXISTING QuoteBuilderDialog (a second, controlled instance of the exact
 * same component the manual flow uses) pre-filled with the AI-returned
 * items/terms and language defaulted to "he" — fully editable from there,
 * exactly like every other quote. On failure it shows the returned error via
 * toast and leaves the normal manual flow completely unaffected.
 */
export function AiQuoteDraftTrigger({
  jobId,
  workTypes,
  initialValidUntil,
}: {
  jobId: string;
  workTypes: { id: string; labelAr: string; defaultUnit: string }[];
  initialValidUntil: string;
}) {
  const [genOpen, setGenOpen] = React.useState(false);
  const action = generateQuoteDraftAction.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);

  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DraftedQuote | null>(null);
  // The description that produced the current draft — carried into the
  // Quote Builder as quote_versions.ai_prompt_notes so there's a record of
  // what was asked for, even after the admin edits the drafted items.
  const [jobDescription, setJobDescription] = React.useState("");

  // Hand a successful draft off to the quote builder and close this dialog;
  // toast the error otherwise. Compares against the previous render's
  // `state` (same "adjust state while rendering" pattern used by
  // useCloseOnSuccess) rather than a useEffect.
  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success && state.draft) {
      setDraft(state.draft);
      setGenOpen(false);
      setBuilderOpen(true);
    } else if (state.error) {
      toast.error(state.error);
    }
  }

  return (
    <>
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <Sparkles className="size-4" />
            إنشاء مسودة بالذكاء الاصطناعي (עברית)
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>إنشاء مسودة بالذكاء الاصطناعي</DialogTitle>
            <DialogDescription>
              صف الشغل المطلوب وسيقترح الذكاء الاصطناعي بنود عرض سعر مبدئية بالعبرية لمراجعتها
              وتعديلها قبل الحفظ أو الإرسال — لن يُرسل أي عرض تلقائياً.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="jobDescription">وصف الشغل</Label>
              <Textarea
                id="jobDescription"
                name="jobDescription"
                rows={5}
                required
                placeholder="مثال: تركيب واجهة زجاجية للمطبخ بمقاس 3×2 متر مع باب منزلق..."
                onChange={(e) => setJobDescription(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setGenOpen(false)}>
                إلغاء
              </Button>
              <GenerateButton />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <QuoteBuilderDialog
        jobId={jobId}
        workTypes={workTypes}
        initialItems={draft ? draftToBuilderItems(draft) : undefined}
        initialPaymentTerms={draft?.paymentTerms}
        initialWorkTerms={draft?.workTerms}
        initialValidUntil={initialValidUntil}
        initialLanguage="he"
        initialIsAiGenerated={Boolean(draft)}
        initialAiPromptNotes={jobDescription || undefined}
        triggerLabel="إنشاء عرض سعر"
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        hideTrigger
      />
    </>
  );
}
