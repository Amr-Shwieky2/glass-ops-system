import { ShieldAlert } from "lucide-react";

/**
 * Shown on a page a signed-in user opened directly (typed URL, old bookmark)
 * without the permission it needs. The nav already hides links they can't
 * use (src/app/(app)/layout.tsx); this is the second, server-enforced line
 * of defense for the page itself — never rely on the nav alone.
 */
export function Forbidden({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" />
      <p className="font-medium text-foreground">
        لا تملك صلاحية الوصول لهذه الصفحة
      </p>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
