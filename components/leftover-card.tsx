"use client";

import { toast } from "sonner";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useDolla } from "./dolla-provider";
import { FormulaBlock } from "./formula-block";

export function LeftoverCard({ compact = false }: { compact?: boolean }) {
  const { insights, setBillFromThisCheck } = useDolla();
  if (!insights) return null;

  async function toggleAmex(reserve: boolean) {
    try {
      await setBillFromThisCheck("amex", reserve);
      toast.success(
        reserve ? "Amex reserved from this paycheck." : "Amex waits for the next paycheck."
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update Amex.");
    }
  }

  return (
    <div className="space-y-3">
      <article className="rounded-3xl bg-card px-5 py-5 ring-1 ring-foreground/10">
        <p className="text-sm text-muted-foreground">Left from this paycheck</p>
        <p
          className={cn(
            "mt-1 font-mono text-4xl font-semibold tracking-tight",
            insights.leftoverPaycheckCents < 0 && "text-destructive"
          )}
        >
          {formatCents(insights.leftoverPaycheckCents)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Paycheck only. Not checking. The {formatCents(insights.paycheckNetCents)} deposit is already
          inside checking and is not added again.
        </p>
        <div className="mt-3">
          <FormulaBlock formula={insights.formulas.paycheck} defaultOpen={!compact} />
        </div>
      </article>

      <article className="rounded-3xl bg-primary px-5 py-5 text-primary-foreground">
        <p className="text-sm font-medium opacity-80">Left in checking</p>
        <p className="mt-1 font-mono text-4xl font-semibold tracking-tight">
          {formatCents(insights.leftoverCheckingCents)}
        </p>
        <p className="mt-2 text-sm opacity-80">
          After this-check bills only. Two-week envelopes are a plan on Split, not a deduction.
          Includes cash that was already there ({formatCents(insights.preDepositCheckingCents)}).
        </p>
        <div className="mt-3">
          <FormulaBlock formula={insights.formulas.checking} defaultOpen={!compact} inverted />
          <FormulaBlock formula={insights.formulas.prior} defaultOpen={false} muted inverted />
        </div>
      </article>

      <article className="rounded-3xl bg-card px-5 py-4 ring-1 ring-foreground/10">
        <FormulaBlock formula={insights.formulas.cards} defaultOpen />
      </article>

      {insights.amexCents > 0 && (
        <article className="rounded-3xl bg-card px-5 py-4 ring-1 ring-foreground/10">
          <p className="text-sm font-medium">Amex {formatCents(insights.amexCents)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Default: next paycheck. Toggle to reserve it from this check.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => toggleAmex(false)}
              className={cn(
                "min-h-12 rounded-xl px-2 text-xs font-medium",
                !insights.amexReserved ? "bg-primary text-primary-foreground" : "bg-muted"
              )}
            >
              Next check
            </button>
            <button
              type="button"
              onClick={() => toggleAmex(true)}
              className={cn(
                "min-h-12 rounded-xl px-2 text-xs font-medium",
                insights.amexReserved ? "bg-primary text-primary-foreground" : "bg-muted"
              )}
            >
              Reserve now
            </button>
          </div>
          <div className="mt-3 space-y-2">
            <FormulaBlock
              formula={insights.formulas.amexWaitPaycheck}
              defaultOpen={!insights.amexReserved}
            />
            <FormulaBlock
              formula={insights.formulas.amexWaitChecking}
              defaultOpen={!insights.amexReserved}
            />
            <FormulaBlock
              formula={insights.formulas.amexNowPaycheck}
              defaultOpen={insights.amexReserved}
            />
            <FormulaBlock
              formula={insights.formulas.amexNowChecking}
              defaultOpen={insights.amexReserved}
            />
          </div>
        </article>
      )}
    </div>
  );
}
