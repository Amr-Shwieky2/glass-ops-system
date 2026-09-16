"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The app-wide exception boundary (Sprint 10 release-gate fix — same gap
 * Sprint 0's audit flagged alongside the missing not-found.tsx: a thrown
 * exception anywhere in the tree had nothing to catch it, so it fell
 * through to Next.js's default, unstyled, English error screen). Must be
 * a Client Component (Next.js requirement for error.tsx) — catches
 * rendering errors in this segment and below, not in the root layout
 * itself (see global-error.tsx for that).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <TriangleAlert className="size-12 text-destructive" />
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-foreground">حدث خطأ غير متوقع</h1>
        <p className="text-sm text-muted-foreground">
          يمكنك المحاولة مرة أخرى أو العودة إلى الصفحة الرئيسية.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => reset()}>حاول مرة أخرى</Button>
        <Button variant="outline" asChild>
          <Link href="/">الصفحة الرئيسية</Link>
        </Button>
      </div>
    </div>
  );
}
