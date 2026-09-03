"use client";

import { formatCents } from "@/lib/money";
import { formatLongDate } from "@/lib/dates";
import type { CategoryId } from "@/lib/types";
import { useDolla } from "./dolla-provider";

export function EnvelopePurchases({
  categoryId,
  empty = "Nothing logged here this month.",
}: {
  categoryId: CategoryId;
  empty?: string;
}) {
  const { state, insights } = useDolla();
  if (!state || !insights) return null;

  const month = insights.monthKey;
  const rows = state.expenses
    .filter((e) => e.categoryId === categoryId && e.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  if (rows.length === 0) {
    return <p className="pt-1 text-xs text-muted-foreground">{empty}</p>;
  }

  return (
    <ul className="mt-2 divide-y divide-border/70">
      {rows.map((e) => (
        <li key={e.id} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{e.merchant}</p>
            <p className="text-xs text-muted-foreground">{formatLongDate(e.date)}</p>
          </div>
          <p className="shrink-0 font-mono text-sm">{formatCents(e.amountCents)}</p>
        </li>
      ))}
    </ul>
  );
}
