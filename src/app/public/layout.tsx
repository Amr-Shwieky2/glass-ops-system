/**
 * Shell for every page under /public/* — customer-facing pages reached via
 * a secure link, no login, no sidebar (section 18's quote signing today;
 * Phase 6's factory submission links will live here too). Deliberately
 * minimal: just the company mark and a centered card, since whoever's
 * looking at this is a customer or a factory contact, not an employee.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-muted/40">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            ز
          </div>
          <span className="text-sm font-semibold text-foreground">
            إدارة عمليات الزجاج
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">{children}</main>
    </div>
  );
}
