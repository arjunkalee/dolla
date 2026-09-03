"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { dollarsToCents, formatCents } from "@/lib/money";
import type { SavingsId } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDolla } from "./dolla-provider";
import { LeftoverCard } from "./leftover-card";

const ORDER: SavingsId[] = ["etrade", "roth", "hysa"];

export function SavingsScreen() {
  const { state, insights, confirmSetAsides, saveSavingsTargets } = useDolla();
  const [amounts, setAmounts] = useState<Record<SavingsId, string>>({
    etrade: "",
    roth: "",
    hysa: "",
  });
  const [targets, setTargets] = useState<Record<SavingsId, string>>({
    etrade: "",
    roth: "",
    hysa: "",
  });
  const [saving, setSaving] = useState(false);
  const [editingTargets, setEditingTargets] = useState(false);

  useEffect(() => {
    if (!state) return;
    setAmounts({ etrade: "", roth: "", hysa: "" });
    setTargets({
      etrade: dollars(state.savings.find((b) => b.id === "etrade")?.targetCents ?? 0),
      roth: dollars(state.savings.find((b) => b.id === "roth")?.targetCents ?? 0),
      hysa: dollars(state.savings.find((b) => b.id === "hysa")?.targetCents ?? 0),
    });
  }, [state]);

  if (!state || !insights) return null;

  async function park() {
    setSaving(true);
    try {
      await confirmSetAsides({
        etrade: dollarsToCents(amounts.etrade),
        roth: dollarsToCents(amounts.roth),
        hysa: dollarsToCents(amounts.hysa),
      });
      toast.success("Moved out of checking into destinations.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function persistTargets() {
    if (!state) return;
    setSaving(true);
    try {
      await saveSavingsTargets(
        state.savings.map((bucket) => ({
          ...bucket,
          targetCents: dollarsToCents(targets[bucket.id]),
        }))
      );
      setEditingTargets(false);
      toast.success("Targets updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Destinations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Leftover after needs goes to eTrade, Roth, and HYSA. Travel and Misc are $200 spend
          envelopes, not these buckets. 401k match is employer — not something to fund here.
        </p>
      </header>

      <LeftoverCard compact />

      <section className="space-y-3">
        {ORDER.map((id) => {
          const bucket = state.savings.find((b) => b.id === id);
          if (!bucket) return null;
          const pct =
            bucket.targetCents > 0
              ? Math.min(100, Math.round((bucket.balanceCents / bucket.targetCents) * 100))
              : 0;
          return (
            <article key={id} className="rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-medium">{bucket.name}</h2>
                <p className="font-mono text-sm">{formatCents(bucket.balanceCents)}</p>
              </div>
              {bucket.targetCents > 0 && (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              )}
              {editingTargets && (
                <Input
                  className="mt-3 h-12 font-mono"
                  inputMode="decimal"
                  value={targets[id]}
                  onChange={(e) => setTargets((t) => ({ ...t, [id]: e.target.value }))}
                  aria-label={`${bucket.name} target`}
                />
              )}
            </article>
          );
        })}
        {editingTargets ? (
          <Button className="h-12 w-full text-base" onClick={persistTargets} disabled={saving}>
            Save targets
          </Button>
        ) : (
          <button type="button" className="text-sm text-primary" onClick={() => setEditingTargets(true)}>
            Optional targets
          </button>
        )}
      </section>

      <section className="rounded-3xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Park leftover checking</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Type amounts yourself. That leftover is checking after holdbacks — not leftover from this
          paycheck. Dolla does not invent a split.
        </p>
        <div className="mt-4 space-y-3">
          {ORDER.map((id) => (
            <div key={id} className="flex items-center gap-3">
              <label className="w-28 text-sm">{state.savings.find((b) => b.id === id)?.name}</label>
              <Input
                inputMode="decimal"
                className="h-12 flex-1 font-mono text-base"
                value={amounts[id]}
                onChange={(e) => setAmounts((a) => ({ ...a, [id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <Button className="mt-4 h-12 w-full text-base" onClick={park} disabled={saving}>
          Move out of checking
        </Button>
      </section>
    </div>
  );
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}
