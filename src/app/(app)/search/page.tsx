import type { Metadata } from "next";
import Link from "next/link";
import { Users, Briefcase } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { globalSearch } from "@/server/search";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "نتائج البحث | نظام إدارة عمليات الزجاج" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = await getCurrentUser();
  const results = q ? await globalSearch(user, q) : { customers: [], jobs: [] };
  const hasResults = results.customers.length > 0 || results.jobs.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">نتائج البحث</h1>
        <p className="text-sm text-muted-foreground">
          نتائج البحث عن &quot;{q}&quot;
        </p>
      </div>

      {!hasResults ? (
        <EmptyState title="لا توجد نتائج مطابقة" />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {results.customers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-5 text-muted-foreground" />
                  العملاء
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {results.customers.map((c) => (
                    <li key={c.id} className="py-3">
                      <Link href={`/customers/${c.id}`} className="font-medium text-foreground hover:underline">
                        {c.name}
                      </Link>
                      <p dir="ltr" className="text-sm text-muted-foreground">
                        {c.phone}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {results.jobs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Briefcase className="size-5 text-muted-foreground" />
                  المهام
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {results.jobs.map((j) => (
                    <li key={j.id} className="flex items-center justify-between py-3">
                      <div>
                        <Link href={`/jobs/${j.id}`} className="font-medium text-foreground hover:underline">
                          {j.jobNumber}
                        </Link>
                        <p className="text-sm text-muted-foreground">{j.customerName}</p>
                      </div>
                      <span className="text-sm text-muted-foreground">{j.statusLabelAr}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
