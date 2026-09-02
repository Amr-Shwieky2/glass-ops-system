"use client";

import * as React from "react";
import { Search, X, Loader2 } from "lucide-react";
import { searchJobsAction, type JobOption } from "./job-search-action";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Optional job-link picker for this area's forms (checks, technician
 * compensation entries) — same debounced-search-popover shape as
 * src/app/(app)/jobs/customer-combobox.tsx, but always optional: nothing
 * is required to be selected, and the hidden field is simply absent when
 * nothing is chosen.
 */
export function JobCombobox({ name, initial }: { name: string; initial?: JobOption | null }) {
  const [selected, setSelected] = React.useState<JobOption | null>(initial ?? null);
  const [query, setQuery] = React.useState("");
  const [rawResults, setResults] = React.useState<JobOption[]>([]);
  const [lastSearchedQuery, setLastSearchedQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const queryTooShort = query.trim().length < 2;
  const results = queryTooShort ? [] : rawResults;
  const loading = !queryTooShort && query !== lastSearchedQuery;

  React.useEffect(() => {
    if (queryTooShort) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const rows = await searchJobsAction(query);
      if (!cancelled) {
        setResults(rows);
        setLastSearchedQuery(query);
        setOpen(true);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, queryTooShort]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2">
        <input type="hidden" name={name} value={selected.id} />
        <div>
          <p className="text-sm font-medium text-foreground">{selected.jobNumber}</p>
          <p className="text-xs text-muted-foreground">{selected.customerName}</p>
        </div>
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="rounded-full p-1 text-muted-foreground hover:bg-accent"
          aria-label="إزالة الاختيار"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="ابحث برقم المهمة أو اسم العميل (اختياري)..."
            className="ps-9"
            autoComplete="off"
          />
          {loading && (
            <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {results.length === 0 ? (
          <p className="p-3 text-center text-sm text-muted-foreground">
            {queryTooShort ? "اكتب حرفين على الأقل للبحث" : "لا توجد نتائج"}
          </p>
        ) : (
          <ul>
            {results.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(j);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full rounded-sm px-3 py-2 text-start text-sm hover:bg-accent",
                  )}
                >
                  <span className="block font-medium text-foreground">{j.jobNumber}</span>
                  <span className="block text-xs text-muted-foreground">{j.customerName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
