"use client";

import { useState } from "react";
import { toast } from "sonner";
import { dollarsToCents, formatCents } from "@/lib/money";
import type { Category, CategoryKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDolla } from "./dolla-provider";
import { FormulaBlock } from "./formula-block";
import { EnvelopePurchases } from "./envelope-purchases";

function dollarsField(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

export function BudgetScreen() {
  const { state, insights, saveBudget, logPurchase } = useDolla();
  const [draft, setDraft] = useState<Category[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [logDraft, setLogDraft] = useState<Record<string, string>>({});
  const [logging, setLogging] = useState<string | null>(null);

  if (!state || !insights) return null;
  const categories = draft ?? state.categories;
  const dirty = draft !== null;
  const total = categories.reduce((sum, c) => sum + c.monthlyBudgetCents, 0);

  function update(id: string, patch: Partial<Category>) {
    setDraft(categories.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function persist() {
    setSaving(true);
    try {
      await saveBudget(categories);
      setDraft(null);
      toast.success("Budget saved. Paycheck plan updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Envelopes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {insights.monthLabel}. These eight envelopes are the set: rent, gas, groceries, dining,
          weekends, utilities, travel, misc. Type a charge in Log $ — that is spend, not the
          monthly envelope. The monthly box only changes the budget. Split allocations are a plan.
        </p>
      </header>

      <div className="rounded-3xl bg-card px-5 py-4 ring-1 ring-foreground/10">
        <p className="text-sm text-muted-foreground">Planned spend this month</p>
        <p className="font-mono text-3xl font-semibold">{formatCents(total)}</p>
        <div className="mt-3 space-y-2">
          <FormulaBlock formula={insights.formulas.monthEnvelopes} defaultOpen />
          <FormulaBlock formula={insights.formulas.monthLeftover} defaultOpen />
          <FormulaBlock formula={insights.formulas.monthSpent} defaultOpen={false} />
        </div>
      </div>

      <section className="space-y-3">
        {categories.map((cat) => {
          const status = insights.categories.find((c) => c.id === cat.id);
          return (
            <article key={cat.id} className="rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Input
                    value={cat.name}
                    onChange={(e) => update(cat.id, { name: e.target.value })}
                    className="h-11 border-0 bg-transparent px-0 text-base font-medium shadow-none focus-visible:ring-0"
                  />
                  <p className="text-xs text-muted-foreground">
                    {status
                      ? `Spent ${formatCents(status.spentCents)} · ${status.remainingCents < 0 ? "over" : "left"} ${formatCents(Math.abs(status.remainingCents))}`
                      : cat.kind === "bill"
                        ? "Bill"
                        : "Flexible"}
                  </p>
                </div>
                <div className="w-28">
                  <p className="mb-1 text-right text-[11px] text-muted-foreground">Monthly envelope</p>
                  <Input
                    inputMode="decimal"
                    value={dollarsField(cat.monthlyBudgetCents)}
                    onChange={(e) =>
                      update(cat.id, {
                        monthlyBudgetCents: Math.max(0, dollarsToCents(e.target.value || "0")),
                      })
                    }
                    className="h-12 text-right font-mono text-base"
                    aria-label={`${cat.name} monthly envelope`}
                  />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                {(["bill", "flexible"] as CategoryKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => update(cat.id, { kind })}
                    className={cn(
                      "h-9 rounded-full px-3 text-xs font-medium",
                      cat.kind === kind ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {kind === "bill" ? "Bill" : "Flexible"}
                  </button>
                ))}
              </div>
              <form
                className="mt-3 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const cents = dollarsToCents(logDraft[cat.id] || "0");
                  if (cents <= 0) {
                    toast.error("Enter a charge to log.");
                    return;
                  }
                  setLogging(cat.id);
                  try {
                    await logPurchase({
                      amountCents: cents,
                      merchant: cat.name,
                      categoryId: cat.id,
                    });
                    setLogDraft((d) => ({ ...d, [cat.id]: "" }));
                    toast.success(`Logged ${formatCents(cents)} → ${cat.name}`);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Could not log.");
                  } finally {
                    setLogging(null);
                  }
                }}
              >
                <Input
                  inputMode="decimal"
                  value={logDraft[cat.id] ?? ""}
                  onChange={(e) => setLogDraft((d) => ({ ...d, [cat.id]: e.target.value }))}
                  placeholder="Log $"
                  className="h-12 flex-1 font-mono text-base"
                  aria-label={`Log spend to ${cat.name}`}
                />
                <Button type="submit" className="h-12 px-4" disabled={logging === cat.id}>
                  Log $
                </Button>
              </form>
              <div className="mt-2">
                <FormulaBlock formula={insights.formulas[`envelope-${cat.id}`]} defaultOpen={status ? status.spentCents > 0 : false} />
                <EnvelopePurchases categoryId={cat.id} />
              </div>
            </article>
          );
        })}
      </section>

      <Button size="lg" className="h-12 w-full text-base" onClick={persist} disabled={saving || !dirty}>
        Save budget
      </Button>
    </div>
  );
}
