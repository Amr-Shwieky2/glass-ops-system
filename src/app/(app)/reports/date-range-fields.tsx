import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The dateFrom/dateTo pair shared by three of the five reports (jobs,
 * technicians, profitability) — plain "YYYY-MM-DD" inputs inside a
 * `<form method="GET">`, same shape as admin/audit-log/page.tsx's own
 * dateFrom/dateTo fields. Not a client component: submission is a normal
 * form GET, no onChange wiring needed.
 */
export function DateRangeFields({
  dateFrom,
  dateTo,
}: {
  dateFrom?: string;
  dateTo?: string;
}) {
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="dateFrom" className="text-xs text-muted-foreground">
          من تاريخ
        </Label>
        <Input id="dateFrom" name="dateFrom" type="date" dir="ltr" defaultValue={dateFrom} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="dateTo" className="text-xs text-muted-foreground">
          إلى تاريخ
        </Label>
        <Input id="dateTo" name="dateTo" type="date" dir="ltr" defaultValue={dateTo} />
      </div>
    </>
  );
}
