"use client";

import Link from "next/link";
import { formatCents } from "@/lib/money";
import { formatLongDate } from "@/lib/dates";
import { expenseEnvelopeLabel } from "@/lib/categorize";
import { Button } from "@/components/ui/button";
import { useDolla } from "./dolla-provider";
import { LeftoverCard } from "./leftover-card";

export function HomeScreen() {
  const { state, insights, setLogOpen } = useDolla();
  const hour = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hourCycle: "h23",
  });
  const n = Number(hour);
  const hello = n < 12 ? "Morning" : n < 17 ? "Afternoon" : "Evening";

  if (!state || !insights) return null;

  const nextBill = [...state.bills]
    .filter((b) => !b.paid)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const nextIsBill = Boolean(nextBill && nextBill.dueDate <= insights.nextPayday);
  const recent = [...state.expenses]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm text-muted-foreground">{insights.monthLabel}</p>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">
          {hello}, {state.profile.name.split(" ")[0]}
        </h1>
      </header>

      <LeftoverCard headlinesOnly />

      <article className="rounded-3xl bg-card px-5 py-5 ring-1 ring-foreground/10">
        <p className="text-sm text-muted-foreground">What's next</p>
        {nextIsBill && nextBill ? (
          <>
            <p className="mt-1 text-xl font-semibold tracking-tight">{nextBill.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Due {formatLongDate(nextBill.dueDate)} · {formatCents(nextBill.amountCents)}
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-xl font-semibold tracking-tight">Next payday</p>
            <p className="mt-1 text-sm text-muted-foreground">{formatLongDate(insights.nextPayday)}</p>
          </>
        )}
      </article>

      {recent.length > 0 ? (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Recent</h2>
            <Link href="/activity" className="text-sm text-primary">
              Activity
            </Link>
          </div>
          <div className="divide-y divide-border/80 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
            {recent.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.merchant}</p>
                  <p className="text-xs text-muted-foreground">
                    {expenseEnvelopeLabel(state.categories, e)} · {formatLongDate(e.date)}
                  </p>
                </div>
                <p className="font-mono text-sm">{formatCents(e.amountCents)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="space-y-3">
        <Button size="lg" className="h-12 w-full text-base" onClick={() => setLogOpen(true)}>
          Log a purchase
        </Button>
        <p className="text-center text-sm">
          <Link href="/split" className="font-medium text-primary">
            Split
          </Link>
          <span className="text-muted-foreground"> / </span>
          <Link href="/plan" className="font-medium text-primary">
            Plan
          </Link>
        </p>
      </div>
    </div>
  );
}
