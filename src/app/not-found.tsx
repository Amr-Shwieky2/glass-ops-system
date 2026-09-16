import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The app-wide 404 (Sprint 10 release-gate fix — Sprint 0's own audit
 * flagged this: with no not-found.tsx anywhere in the tree, a stale or
 * mistyped link — routine in a field-service app shared over WhatsApp/SMS
 * — fell straight through to Next.js's default, unstyled, English "This
 * page could not be found," dropping the user out of an otherwise
 * 100%-Arabic-RTL app with no way back in). Deliberately generic (not
 * "job not found" / "customer not found" specific text) — Next.js renders
 * this same file for every notFound() call and every genuinely unmatched
 * route alike, so it can't know which entity was being looked for.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <FileQuestion className="size-12 text-muted-foreground" />
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-foreground">الصفحة غير موجودة</h1>
        <p className="text-sm text-muted-foreground">
          الرابط الذي فتحته غير صحيح أو لم يعد متاحاً.
        </p>
      </div>
      <Button asChild>
        <Link href="/">العودة إلى الصفحة الرئيسية</Link>
      </Button>
    </div>
  );
}
