"use client";

import * as React from "react";
import { Search, X, Loader2 } from "lucide-react";
import { searchCustomersAction } from "@/server/customers/actions";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface CustomerOption {
  id: string;
  name: string;
  phone: string;
  address: string | null;
}

export function CustomerCombobox({
  name,
  initial,
}: {
  name: string;
  initial?: CustomerOption | null;
}) {
  const [selected, setSelected] = React.useState<CustomerOption | null>(
    initial ?? null,
  );
  const [query, setQuery] = React.useState("");
  const [rawResults, setResults] = React.useState<CustomerOption[]>([]);
  const [lastSearchedQuery, setLastSearchedQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);

  // Derived, not stored: whenever the query is too short there ARE no
  // results, full stop — no need to also remember to reset state for that
  // case. Likewise `loading` is just "is the query eligible but not the one
  // we last got results for yet" rather than its own flag — both used to be
  // set synchronously at the top of the effect below, which is exactly the
  // "state that could just be computed" the react-hooks/set-state-in-effect
  // rule flags; the effect now only calls setState from inside the actual
  // async callback, once the debounced search really resolves.
  const queryTooShort = query.trim().length < 2;
  const results = queryTooShort ? [] : rawResults;
  const loading = !queryTooShort && query !== lastSearchedQuery;

  React.useEffect(() => {
    if (queryTooShort) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const rows = await searchCustomersAction(query);
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
          <p className="text-sm font-medium text-foreground">{selected.name}</p>
          <p className="text-xs text-muted-foreground" dir="ltr">
            {selected.phone}
          </p>
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
            placeholder="ابحث بالاسم أو رقم الهاتف..."
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
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(c);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full rounded-sm px-3 py-2 text-start text-sm hover:bg-accent",
                  )}
                >
                  <span className="block font-medium text-foreground">{c.name}</span>
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    {c.phone}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
