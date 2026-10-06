"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { envelopeSpend } from "@/lib/envelope-spend";
import { formatCents, dollarsToCents } from "@/lib/money";
import type { CategoryId, SplitAllocation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useDolla } from "./dolla-provider";
import { FormulaBlock } from "./formula-block";

const ENVELOPE_COLORS: Record<string, string> = {
  gas: "oklch(0.72 0.12 85)",
  groceries: "oklch(0.7 0.14 145)",
  dining: "oklch(0.74 0.13 25)",
  weekends: "oklch(0.72 0.12 310)",
  utilities: "oklch(0.7 0.08 220)",
  travel: "oklch(0.73 0.1 200)",
  misc: "oklch(0.68 0.04 145)",
};

type Bucket = {
  id: string;
  label: string;
  cents: number;
  kind: "bill" | "envelope" | "leftover";
  color: string;
  locked?: boolean;
  optedIn?: boolean;
  suggestedCents?: number;
  categoryId?: CategoryId;
  spentCents?: number;
  budgetCents?: number;
  remainingCents?: number;
  empty?: boolean;
};

function useCountUp(target: number, duration = 720) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

export function SplitScreen() {
  const { state, insights, saveSplit } = useDolla();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const poured = useCountUp(state?.paycheck.netCents ?? 0);
  const leftoverShown = useCountUp(insights?.splitPlayLeftoverCents ?? 0);

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 40);
    return () => window.clearTimeout(id);
  }, []);

  if (!state || !insights) return null;

  const bills = state.bills.filter((b) => !b.paid && b.fromThisCheck);
  const billBuckets: Bucket[] = bills.map((b) => ({
    id: b.id,
    label: b.name.replace(/ card$/i, ""),
    cents: b.amountCents,
    kind: "bill",
    locked: true,
    color: /rent/i.test(b.name)
      ? "oklch(0.78 0.13 145)"
      : /apple/i.test(b.name)
        ? "oklch(0.82 0.04 250)"
        : "oklch(0.78 0.12 70)",
  }));

  const envelopeBuckets: Bucket[] = insights.splitAllocations.map((a) => {
    const spend = envelopeSpend(insights.categories, a.categoryId);
    return {
      id: a.categoryId,
      label: a.name.replace(/ \/ .+$/, ""),
      cents: a.cents,
      kind: "envelope" as const,
      optedIn: a.optedIn,
      suggestedCents: a.suggestedCents,
      categoryId: a.categoryId,
      color: ENVELOPE_COLORS[a.categoryId] ?? "oklch(0.7 0.06 145)",
      spentCents: spend.spentCents,
      budgetCents: spend.budgetCents,
      remainingCents: spend.remainingCents,
      empty: spend.empty,
    };
  });
  const listedSpentCents = envelopeBuckets.reduce((sum, b) => sum + (b.spentCents ?? 0), 0);

  const leftover: Bucket = {
    id: "leftover",
    label: "Leftover to invest",
    cents: insights.splitPlayLeftoverCents,
    kind: "leftover",
    color: "oklch(0.84 0.16 145)",
  };

  const maxVisual = Math.max(
    ...billBuckets.map((b) => b.cents),
    ...envelopeBuckets.map((b) => Math.max(b.cents, b.suggestedCents ?? 0, 12_000)),
    Math.abs(leftover.cents),
    1
  );

  const openBucket =
    [...billBuckets, ...envelopeBuckets, leftover].find((b) => b.id === openId) ?? null;

  async function persist(next: SplitAllocation[]) {
    setBusy(true);
    try {
      await saveSplit(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save split.");
    } finally {
      setBusy(false);
    }
  }

  function currentAllocations(): SplitAllocation[] {
    return insights!.splitAllocations.map((a) => ({
      categoryId: a.categoryId,
      cents: a.cents,
      optedIn: a.optedIn,
    }));
  }

  async function patchEnvelope(id: CategoryId, patch: Partial<SplitAllocation>) {
    const next = currentAllocations().map((a) => (a.categoryId === id ? { ...a, ...patch } : a));
    await persist(next);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Split</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This paycheck pours into bills first. Envelopes are a plan until you count them.
        </p>
      </header>

      <div className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-b from-primary/25 to-card px-5 py-6 ring-1 ring-primary/30">
        <p className="text-sm text-primary">This paycheck</p>
        <p className="mt-1 font-mono text-4xl font-semibold tracking-tight">{formatCents(poured)}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Already in checking. Split is allocation, not a second deposit.
        </p>
        <div className="pointer-events-none absolute inset-x-8 -bottom-6 h-10 rounded-full bg-primary/20 blur-xl" />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium">Due from this check</h2>
        <div className="grid grid-cols-2 gap-2">
          {billBuckets.map((bucket, i) => (
            <BucketCard
              key={bucket.id}
              bucket={bucket}
              max={maxVisual}
              delay={80 + i * 70}
              ready={ready}
              wide={/rent/i.test(bucket.label)}
              onOpen={() => setOpenId(bucket.id)}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium">Envelopes · play, not withdrawn</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          Spent against each monthly envelope. Empty ones stay listed.
          {listedSpentCents === insights.monthSpentCents
            ? ` ${formatCents(listedSpentCents)} matches Spent this month.`
            : ` These envelopes ${formatCents(listedSpentCents)}. Spent this month ${formatCents(insights.monthSpentCents)}.`}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {envelopeBuckets.map((bucket, i) => (
            <BucketCard
              key={bucket.id}
              bucket={bucket}
              max={maxVisual}
              delay={280 + i * 55}
              ready={ready}
              onOpen={() => {
                setDraft(((bucket.cents || bucket.suggestedCents || 0) / 100).toString());
                setOpenId(bucket.id);
              }}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">After this-check bills</h2>
        <button
          type="button"
          onClick={() => setOpenId("leftover")}
          className="w-full overflow-hidden rounded-3xl bg-primary px-5 py-5 text-left text-primary-foreground"
        >
          <p className="text-sm opacity-80">{leftover.label}</p>
          <p
            className={cn(
              "mt-1 font-mono text-4xl font-semibold tracking-tight",
              leftover.cents < 0 && "text-destructive"
            )}
          >
            {formatCents(leftoverShown)}
          </p>
          <p className="mt-2 text-sm opacity-80">
            Official leftover is {formatCents(insights.leftoverPaycheckCents)} after bills
            {insights.optedInEnvelopeCents > 0
              ? ` and ${formatCents(insights.optedInEnvelopeCents)} counted envelopes`
              : ""}
            . Play amounts above do not count until you opt them in.
          </p>
        </button>
      </section>

      <Drawer
        open={openBucket !== null}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
      >
        <DrawerContent className="mx-auto max-w-lg">
          {openBucket && (
            <>
              <DrawerHeader className="text-left">
                <DrawerTitle>{openBucket.label}</DrawerTitle>
                <DrawerDescription>
                  {openBucket.kind === "bill"
                    ? "Due from this paycheck. Amount is the bill, not a prediction."
                    : openBucket.kind === "envelope"
                      ? "Spent against the monthly envelope. The field below is this paycheck's plan."
                      : "Paycheck minus this-check bills minus envelope amounts you are playing with."}
                </DrawerDescription>
              </DrawerHeader>
              <div className="space-y-3 px-4 pb-2">
                {openBucket.kind !== "envelope" && (
                  <p className="font-mono text-3xl font-semibold">{formatCents(openBucket.cents)}</p>
                )}
                {openBucket.kind === "bill" && insights.formulas.cards && (
                  <FormulaBlock
                    formula={
                      /rent/i.test(openBucket.label) ? insights.formulas.paycheck : insights.formulas.cards
                    }
                    defaultOpen
                  />
                )}
                {openBucket.kind === "leftover" && (
                  <FormulaBlock formula={insights.formulas.paycheck} defaultOpen />
                )}
                {openBucket.kind === "envelope" && openBucket.categoryId && (
                  <>
                    <p
                      className={cn(
                        "font-mono text-3xl font-semibold",
                        openBucket.empty && "font-medium text-muted-foreground/80"
                      )}
                    >
                      {formatCents(openBucket.spentCents ?? 0)}
                      <span className="text-lg font-normal text-muted-foreground">
                        {" "}
                        / {formatCents(openBucket.budgetCents ?? 0)}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {openBucket.empty
                        ? "Empty this month."
                        : openBucket.remainingCents !== undefined && openBucket.remainingCents < 0
                          ? `Over by ${formatCents(Math.abs(openBucket.remainingCents))}.`
                          : `${formatCents(openBucket.remainingCents ?? 0)} left this month.`}
                    </p>
                    <Input
                      inputMode="decimal"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="h-12 font-mono text-base"
                      aria-label={`${openBucket.label} planned amount`}
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="h-11 flex-1"
                        disabled={busy}
                        onClick={() => {
                          setDraft(((openBucket.suggestedCents ?? 0) / 100).toString());
                        }}
                      >
                        Suggest {formatCents(openBucket.suggestedCents ?? 0)}
                      </Button>
                      <Button
                        className="h-11 flex-1"
                        disabled={busy}
                        onClick={() =>
                          patchEnvelope(openBucket.categoryId!, {
                            cents: Math.max(0, dollarsToCents(draft || "0")),
                          })
                        }
                      >
                        Save plan
                      </Button>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        patchEnvelope(openBucket.categoryId!, { optedIn: !openBucket.optedIn })
                      }
                      className={cn(
                        "flex min-h-12 w-full items-center justify-between rounded-2xl px-4 text-sm font-medium",
                        openBucket.optedIn
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      <span>Count against leftover</span>
                      <span>{openBucket.optedIn ? "On" : "Off"}</span>
                    </button>
                    <FormulaBlock
                      formula={insights.formulas[`envelope-${openBucket.categoryId}`]}
                      defaultOpen
                    />
                  </>
                )}
              </div>
              <DrawerFooter>
                <Button variant="ghost" className="h-12" onClick={() => setOpenId(null)}>
                  Close
                </Button>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function BucketCard({
  bucket,
  max,
  delay,
  ready,
  wide,
  onOpen,
}: {
  bucket: Bucket;
  max: number;
  delay: number;
  ready: boolean;
  wide?: boolean;
  onOpen: () => void;
}) {
  const empty = bucket.kind === "envelope" && Boolean(bucket.empty);
  const budgetCents = bucket.budgetCents ?? 0;
  const spentCents = bucket.spentCents ?? 0;
  const spendRatio =
    budgetCents > 0 ? Math.min(1, spentCents / budgetCents) : spentCents > 0 ? 1 : 0;
  const visual = Math.max(bucket.cents, bucket.suggestedCents ?? 0, 8_000);
  const fill =
    bucket.kind === "envelope"
      ? empty
        ? 8
        : Math.max(24, Math.round(spendRatio * 92))
      : Math.max(8, Math.round((visual / max) * 88));
  const filled = bucket.kind === "envelope" ? !empty : bucket.cents > 0;
  const shown = useCountUp(bucket.cents);
  const spentShown = useCountUp(spentCents);

  return (
    <button
      type="button"
      onClick={onOpen}
      data-envelope={bucket.kind === "envelope" ? (empty ? "empty" : "populated") : undefined}
      data-spent-cents={bucket.kind === "envelope" ? spentCents : undefined}
      data-budget-cents={bucket.kind === "envelope" ? budgetCents : undefined}
      className={cn(
        "relative overflow-hidden rounded-2xl text-left ring-1 transition-transform active:scale-[0.98]",
        bucket.kind === "envelope" ? "min-h-[8.75rem]" : "min-h-[7.5rem]",
        empty ? "bg-muted/50 text-muted-foreground ring-foreground/5" : "bg-card ring-foreground/10",
        wide && "col-span-2"
      )}
    >
      <span
        className="absolute inset-x-0 bottom-0 origin-bottom transition-transform duration-700 ease-out"
        style={{
          height: `${fill}%`,
          background: `linear-gradient(180deg, color-mix(in oklch, ${bucket.color} 55%, transparent), ${bucket.color})`,
          transform: ready ? "scaleY(1)" : "scaleY(0)",
          transitionDelay: `${delay}ms`,
          opacity: filled ? 0.95 : 0.16,
        }}
      />
      <span
        className={cn(
          "relative flex h-full flex-col justify-between px-3 py-3",
          bucket.kind === "envelope" ? "min-h-[8.75rem]" : "min-h-[7.5rem]"
        )}
      >
        <span className={cn("text-sm font-medium leading-tight", empty && "text-muted-foreground")}>
          {bucket.label}
        </span>
        <span>
          {bucket.kind === "envelope" ? (
            <>
              <span
                className={cn(
                  "block font-mono text-lg font-semibold",
                  empty && "font-medium text-muted-foreground/75"
                )}
              >
                {formatCents(spentShown)}
                <span
                  className={cn(
                    "ml-1 text-xs font-normal",
                    empty ? "text-muted-foreground/60" : "text-muted-foreground"
                  )}
                >
                  / {formatCents(budgetCents)}
                </span>
              </span>
              <span
                className={cn(
                  "block text-[11px]",
                  empty ? "text-muted-foreground/70" : "text-muted-foreground"
                )}
              >
                {empty
                  ? "Empty this month"
                  : bucket.remainingCents !== undefined && bucket.remainingCents < 0
                    ? `Over ${formatCents(Math.abs(bucket.remainingCents))}`
                    : `Left ${formatCents(bucket.remainingCents ?? 0)}`}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {bucket.optedIn ? "Counted" : "Plan only"}
                {bucket.cents > 0 ? ` · ${formatCents(shown)}` : ""}
                {bucket.suggestedCents ? ` · suggest ${formatCents(bucket.suggestedCents)}` : ""}
              </span>
            </>
          ) : (
            <>
              <span className="block font-mono text-lg font-semibold">{formatCents(shown)}</span>
              {bucket.kind === "bill" && (
                <span className="text-[11px] text-muted-foreground">Due this check</span>
              )}
            </>
          )}
        </span>
      </span>
    </button>
  );
}
