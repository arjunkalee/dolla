"use client";

import { useCallback, useEffect, useRef, type Ref } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Eye, EyeOff } from "lucide-react";
import {
  categoryDrilldown,
  categoryDrilldownSummary,
  type CategoryDrilldown,
} from "@/lib/category-expenses";
import { formatLongDate } from "@/lib/dates";
import { useHideDollars } from "@/lib/hide-dollars";
import { formatCents } from "@/lib/money";
import { budgetBreakdown } from "@/lib/budget-share";
import { cn } from "@/lib/utils";
import { useDolla } from "./dolla-provider";

export function BudgetCategoryScreen({ categoryId }: { categoryId: string }) {
  const router = useRouter();
  const { state, insights } = useDolla();
  const [hideDollars, setHideDollars] = useHideDollars();
  const backRef = useRef<HTMLButtonElement>(null);
  const ready = Boolean(state && insights);

  const returnToBudget = useCallback(() => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.replace("/budget");
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") returnToBudget();
    }
    window.addEventListener("keydown", onKey);
    backRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, returnToBudget, categoryId]);

  if (!state || !insights) return null;

  const breakdown = budgetBreakdown({
    envelopes: insights.categories.map((category) => ({
      id: category.id,
      name: category.name,
      cents: category.budgetCents,
    })),
    monthIncomeCents: insights.monthIncomeCents,
    leftoverMonthCents: insights.savingsSuggestion.leftoverMonthCents,
  });
  const share = breakdown.shares.find((row) => row.id === categoryId) ?? null;
  const drilldown = categoryDrilldown({
    categoryId,
    monthKey: insights.monthKey,
    expenses: state.expenses,
    share,
  });

  return (
    <CategoryExpenseList
      monthLabel={insights.monthLabel}
      drilldown={drilldown}
      hideDollars={hideDollars}
      backRef={backRef}
      onBack={returnToBudget}
      onToggleDollars={() => setHideDollars(!hideDollars)}
    />
  );
}

export function CategoryExpenseList({
  monthLabel,
  drilldown,
  hideDollars,
  backRef,
  onBack,
  onToggleDollars,
}: {
  monthLabel: string;
  drilldown: CategoryDrilldown;
  hideDollars: boolean;
  backRef?: Ref<HTMLButtonElement>;
  onBack: () => void;
  onToggleDollars: () => void;
}) {
  const summary = categoryDrilldownSummary(drilldown, hideDollars);

  return (
    <div className="space-y-5">
      <div className="sticky top-[calc(env(safe-area-inset-top)+3rem)] z-20 -mx-4 bg-background/95 px-2 pb-1 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <button
            ref={backRef}
            type="button"
            onClick={onBack}
            aria-label="Back to budget"
            className="inline-flex h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-sm font-medium text-foreground touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-5" aria-hidden />
            Budget
          </button>
          {drilldown.known ? (
            <HideDollarsToggle hidden={hideDollars} onToggle={onToggleDollars} />
          ) : null}
        </div>
      </div>

      {drilldown.known ? (
        <>
          <header>
            <p className="text-sm text-muted-foreground">{monthLabel}</p>
            <h1 className="mt-1 flex items-center gap-2 text-[1.75rem] font-semibold tracking-tight">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: drilldown.color }}
              />
              <span className="min-w-0 truncate">{drilldown.name}</span>
            </h1>
          </header>

          <article className="rounded-3xl bg-card px-5 py-5 ring-1 ring-foreground/10">
            <p className="text-sm text-muted-foreground">{drilldown.totalLabel}</p>
            {hideDollars ? (
              <p className="mt-1 text-sm text-muted-foreground">Dollar amounts hidden</p>
            ) : (
              <p className="mt-1 font-mono text-3xl font-semibold tracking-tight">
                {formatCents(drilldown.totalCents)}
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">{summary}</p>
          </article>

          {drilldown.invest ? null : drilldown.rows.length === 0 ? (
            <p className="rounded-2xl bg-card px-4 py-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
              {drilldown.emptyLabel}
            </p>
          ) : (
            <ul
              aria-label={`${drilldown.name} expenses`}
              className="divide-y divide-border/80 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10"
            >
              {drilldown.rows.map((row) => (
                <li key={row.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium">{row.merchant}</p>
                    <p className="text-sm text-muted-foreground">{formatLongDate(row.date)}</p>
                  </div>
                  {hideDollars ? null : (
                    <p className="shrink-0 font-mono text-base tabular-nums">{formatCents(row.amountCents)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Budget</h1>
          <p className="rounded-2xl bg-card px-4 py-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
            {drilldown.emptyLabel}
          </p>
        </>
      )}
    </div>
  );
}

function HideDollarsToggle({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  const label = hidden ? "Show dollar amounts" : "Hide dollar amounts";
  return (
    <button
      type="button"
      aria-pressed={hidden}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        hidden ? "bg-primary text-primary-foreground" : "bg-card text-foreground ring-1 ring-foreground/10"
      )}
    >
      {hidden ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
    </button>
  );
}
