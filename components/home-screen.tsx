"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { formatCents, dollarsToCents } from "@/lib/money";
import { formatLongDate } from "@/lib/dates";
import { expenseEnvelopeLabel } from "@/lib/categorize";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDolla } from "./dolla-provider";
import { LeftoverCard } from "./leftover-card";
import { FormulaBlock } from "./formula-block";
import { EnvelopePurchases } from "./envelope-purchases";

export function HomeScreen() {
  const { state, insights, setLogOpen } = useDolla();
  const [check, setCheck] = useState("");
  const hour = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hourCycle: "h23",
  });
  const n = Number(hour);
  const hello = n < 12 ? "Morning" : n < 17 ? "Afternoon" : "Evening";

  const checkCents = check ? dollarsToCents(check) : 0;
  const verdict = useMemo(() => {
    if (!insights || !checkCents) return null;
    if (checkCents <= insights.leftoverPaycheckCents) {
      return {
        ok: true,
        title: "Yes — that still fits leftover from this paycheck",
        detail: `${formatCents(insights.leftoverPaycheckCents - checkCents)} would remain after cards and rent.`,
      };
    }
    if (checkCents <= insights.leftoverCheckingCents) {
      return {
        ok: true,
        title: "It fits leftover checking, not this paycheck",
        detail: "This paycheck leftover is already spoken for by cards and rent. Prior cash could cover it.",
      };
    }
    return {
      ok: false,
      title: "That is more than leftover checking",
      detail: "After this-check bills, checking would go negative.",
    };
  }, [checkCents, insights]);

  if (!state || !insights) return null;

  const upcoming = [...state.bills]
    .filter((b) => !b.paid)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const recent = [...state.expenses]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-muted-foreground">{insights.monthLabel}</p>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">
          {hello}, {state.profile.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Checking {formatCents(state.checkingCents)} · next payday {formatLongDate(insights.nextPayday)}
        </p>
      </header>

      <LeftoverCard />

      <article className="rounded-3xl bg-card px-5 py-5 ring-1 ring-foreground/10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Am I on track this paycheck?</p>
            <p className="mt-1 text-xl font-semibold">{insights.onTrackLabel}</p>
          </div>
          <span
            className={cn(
              "mt-1 rounded-full px-2.5 py-1 text-xs font-medium",
              insights.onTrack ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
            )}
          >
            {insights.onTrack ? "On track" : "Off pace"}
          </span>
        </div>
        <div className="mt-3">
          <FormulaBlock formula={insights.formulas.dailyPace} defaultOpen />
        </div>
        <Link
          href="/split"
          className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary"
        >
          Split this paycheck <ArrowRight className="ml-1 size-4" />
        </Link>
      </article>

      <section className="rounded-3xl bg-card px-5 py-4 ring-1 ring-foreground/10">
        <p className="text-sm font-medium">Can I spend this?</p>
        <p className="text-sm text-muted-foreground">Type a price against leftover from this paycheck, then leftover checking.</p>
        <Input
          inputMode="decimal"
          value={check}
          onChange={(e) => setCheck(e.target.value)}
          placeholder="$0.00"
          className="mt-3 h-12 text-base"
        />
        {verdict && (
          <div className={cn("mt-3 text-sm", verdict.ok ? "text-primary" : "text-destructive")}>
            <p className="font-medium">{verdict.title}</p>
            <p className="mt-1 text-muted-foreground">{verdict.detail}</p>
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-sm font-medium">This week</h2>
        </div>
        <div className="space-y-2">
          {insights.suggestions.map((s) => (
            <article
              key={s.id}
              className={cn(
                "rounded-2xl px-4 py-3 ring-1 ring-foreground/10",
                s.tone === "cut" && "bg-destructive/10",
                s.tone === "warn" && "bg-amber-500/10",
                s.tone === "save" && "bg-primary/10",
                s.tone === "good" && "bg-card",
                s.tone === "now" && "bg-card"
              )}
            >
              <p className="font-medium">{s.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Upcoming bills</h2>
          <Link href="/month" className="text-sm text-primary">
            Edit
          </Link>
        </div>
        <div className="divide-y divide-border/80 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
          {upcoming.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No unpaid bills.</p>
          ) : (
            upcoming.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatLongDate(b.dueDate)}
                    {b.fromThisCheck ? " · this paycheck" : " · next paycheck"}
                  </p>
                </div>
                <p className="font-mono text-sm">{formatCents(b.amountCents)}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Envelopes left</h2>
          <Link href="/budget" className="text-sm text-primary">
            Edit
          </Link>
        </div>
        <div className="space-y-2">
          {insights.categories.map((c) => (
            <div key={c.id} className="rounded-2xl bg-card px-4 py-2 ring-1 ring-foreground/10">
              <FormulaBlock formula={insights.formulas[`envelope-${c.id}`]} defaultOpen={c.spentCents > 0} />
              <EnvelopePurchases categoryId={c.id} empty="" />
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent</h2>
          <Link href="/activity" className="text-sm text-primary">
            All activity
          </Link>
        </div>
        <div className="divide-y divide-border/80 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
          {recent.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing logged yet. The starting ledger has no sample purchases.
            </p>
          ) : (
            recent.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.merchant}</p>
                  <p className="text-xs text-muted-foreground">
                    {expenseEnvelopeLabel(state.categories, e)} · {formatLongDate(e.date)}
                  </p>
                </div>
                <p className="font-mono text-sm">{formatCents(e.amountCents)}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <Button size="lg" className="h-12 w-full text-base" onClick={() => setLogOpen(true)}>
        Log a purchase
      </Button>
    </div>
  );
}
