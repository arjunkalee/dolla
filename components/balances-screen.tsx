"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import { dollarsField, dollarsToCents, formatCents } from "@/lib/money";
import { formatLongDate } from "@/lib/dates";
import { sortBillsForEdit } from "@/lib/freshness";
import type { BillKind, UpcomingBill } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useDolla } from "./dolla-provider";
import { AsOfText } from "./as-of";

function billDraftDirty(draft: UpcomingBill, live: UpcomingBill | undefined): boolean {
  if (!live) return true;
  return (
    draft.name !== live.name ||
    draft.amountCents !== live.amountCents ||
    draft.dueDate !== live.dueDate
  );
}

export function BalancesScreen() {
  const { state, insights, saveChecking, saveBills, setBillPaid, setBillFromThisCheck } = useDolla();
  const [checking, setChecking] = useState("");
  const [checkingDirty, setCheckingDirty] = useState(false);
  const [bills, setBills] = useState<UpcomingBill[] | null>(null);
  const [busy, setBusy] = useState(false);

  const liveBills = state?.bills ?? [];
  const draftBills = bills ?? liveBills;
  const ordered = useMemo(() => sortBillsForEdit(draftBills), [draftBills]);

  if (!state || !insights) return null;

  const checkingValue = checkingDirty ? checking : dollarsField(state.checkingCents);
  const billsDirty = Boolean(bills);

  async function persistChecking() {
    setBusy(true);
    try {
      await saveChecking(dollarsToCents(checkingValue));
      setCheckingDirty(false);
      toast.success("Checking updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save checking.");
    } finally {
      setBusy(false);
    }
  }

  async function persistBills() {
    setBusy(true);
    try {
      await saveBills(draftBills);
      setBills(null);
      toast.success("Bills saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save bills.");
    } finally {
      setBusy(false);
    }
  }

  function updateBill(id: string, patch: Partial<UpcomingBill>) {
    setBills(draftBills.map((bill) => (bill.id === id ? { ...bill, ...patch } : bill)));
  }

  async function flushDraftThen(run: () => Promise<void>) {
    if (bills) {
      await saveBills(draftBills);
      setBills(null);
    }
    await run();
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Balances & bills</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Checking and dated bills. Leftover math updates when you save. Nothing is invented here.
        </p>
      </header>

      <section className="rounded-3xl bg-card px-5 py-5 ring-1 ring-foreground/10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="checking-balance" className="text-sm text-muted-foreground">
              Checking
            </Label>
            <p className="mt-1 font-mono text-3xl font-semibold tracking-tight">
              {formatCents(state.checkingCents)}
            </p>
            <AsOfText iso={state.checkingUpdatedAt} empty="Not updated yet" className="mt-1" />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Already includes the {formatCents(state.paycheck.netCents)} paycheck if it landed.
        </p>
        <Input
          id="checking-balance"
          inputMode="decimal"
          value={checkingValue}
          onChange={(e) => {
            setCheckingDirty(true);
            setChecking(e.target.value);
          }}
          className="mt-3 h-12 font-mono text-base"
          aria-label="Checking balance"
        />
        <Button
          className="mt-3 h-12 w-full text-base"
          onClick={() => void persistChecking()}
          disabled={busy || !checkingDirty}
        >
          Save checking
        </Button>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Dated bills</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bank of America, Apple Card, Amex, and rent. Amount, due date, paid, and this-check.
          </p>
        </div>
        {ordered.map((bill) => {
          const live = liveBills.find((item) => item.id === bill.id);
          const dirty = billDraftDirty(bill, live);
          return (
            <article key={bill.id} className="space-y-3 rounded-3xl bg-card px-5 py-5 ring-1 ring-foreground/10">
              <div>
                <Input
                  value={bill.name}
                  onChange={(e) => updateBill(bill.id, { name: e.target.value })}
                  className="h-11 border-0 bg-transparent px-0 text-base font-medium shadow-none focus-visible:ring-0"
                  aria-label={`${bill.name} name`}
                />
                <AsOfText iso={live?.updatedAt} empty="Not updated yet" />
                <p className="mt-1 text-xs text-muted-foreground">
                  Due {formatLongDate(bill.dueDate)}
                  {bill.kind === "rent" ? " · rent" : bill.kind === "card" ? " · card" : ""}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor={`${bill.id}-amount`} className="text-xs text-muted-foreground">
                    Amount
                  </Label>
                  <Input
                    id={`${bill.id}-amount`}
                    inputMode="decimal"
                    value={dollarsField(bill.amountCents)}
                    onChange={(e) =>
                      updateBill(bill.id, {
                        amountCents: Math.max(0, dollarsToCents(e.target.value || "0")),
                      })
                    }
                    className="mt-1 h-12 font-mono"
                    aria-label={`${bill.name} amount`}
                  />
                </div>
                <div>
                  <Label htmlFor={`${bill.id}-due`} className="text-xs text-muted-foreground">
                    Due
                  </Label>
                  <Input
                    id={`${bill.id}-due`}
                    type="date"
                    value={bill.dueDate}
                    onChange={(e) => updateBill(bill.id, { dueDate: e.target.value })}
                    className="mt-1 h-12"
                    aria-label={`${bill.name} due date`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      try {
                        await flushDraftThen(() =>
                          setBillFromThisCheck(bill.id, !bill.fromThisCheck)
                        );
                        toast.success(
                          !bill.fromThisCheck
                            ? `${bill.name} reserved from this paycheck.`
                            : `${bill.name} waits for the next paycheck.`
                        );
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Could not update bill.");
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                  className={cn(
                    "min-h-12 rounded-xl px-2 text-xs font-medium",
                    bill.fromThisCheck ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}
                >
                  {bill.fromThisCheck ? "From this paycheck" : "From next paycheck"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      try {
                        await flushDraftThen(() => setBillPaid(bill.id, !bill.paid));
                        toast.success(bill.paid ? `${bill.name} marked unpaid.` : `Paid ${bill.name}.`);
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Could not update bill.");
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                  className={cn(
                    "min-h-12 rounded-xl px-2 text-xs font-medium",
                    bill.paid ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  {bill.paid ? "Paid" : "Mark paid"}
                </button>
              </div>
              {dirty ? (
                <Button
                  className="h-12 w-full text-base"
                  onClick={() => void persistBills()}
                  disabled={busy}
                >
                  Save {bill.name}
                </Button>
              ) : null}
            </article>
          );
        })}
        <Button
          variant="outline"
          className="h-12 w-full text-base"
          onClick={() =>
            setBills([
              ...draftBills,
              {
                id: nanoid(),
                name: "New bill",
                amountCents: 0,
                dueDate: insights.todayISO,
                paid: false,
                kind: "other" as BillKind,
                fromThisCheck: true,
              },
            ])
          }
        >
          Add a bill
        </Button>
        {billsDirty ? (
          <Button className="h-12 w-full text-base" onClick={() => void persistBills()} disabled={busy}>
            Save bills
          </Button>
        ) : null}
      </section>
    </div>
  );
}
