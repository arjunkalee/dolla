"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import { dollarsToCents, formatCents } from "@/lib/money";
import { daysInMonth, formatLongDate, formatMonthLabel, startOfMonth } from "@/lib/dates";
import type { BillKind, UpcomingBill } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useDolla } from "./dolla-provider";
import { LeftoverCard } from "./leftover-card";
import { FormulaBlock } from "./formula-block";

function dollarsField(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

export function MonthScreen() {
  const { state, insights, saveChecking, saveBills, setBillPaid, savePaycheck } = useDolla();
  const [checking, setChecking] = useState("");
  const [checkingDirty, setCheckingDirty] = useState(false);
  const [net, setNet] = useState("");
  const [anchor, setAnchor] = useState("");
  const [payDirty, setPayDirty] = useState(false);
  const [bills, setBills] = useState<UpcomingBill[] | null>(null);
  const [busy, setBusy] = useState(false);

  const months = useMemo(() => {
    if (!insights) return [];
    const keys = new Set<string>();
    keys.add(insights.monthKey);
    keys.add(insights.nextPayday.slice(0, 7));
    for (const ev of insights.calendar) keys.add(ev.date.slice(0, 7));
    return [...keys].sort();
  }, [insights]);

  if (!state || !insights) return null;
  const draftBills = bills ?? state.bills;
  const checkingValue = checkingDirty ? checking : dollarsField(state.checkingCents);
  const netValue = payDirty ? net : dollarsField(state.paycheck.netCents);
  const anchorValue = payDirty ? anchor : state.paycheck.anchorDate;

  async function persistChecking() {
    setBusy(true);
    try {
      await saveChecking(dollarsToCents(checkingValue));
      setCheckingDirty(false);
      toast.success("Checking updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function persistPay() {
    setBusy(true);
    try {
      await savePaycheck({
        netCents: dollarsToCents(netValue),
        cadence: "biweekly",
        anchorDate: anchorValue,
      });
      setPayDirty(false);
      toast.success("Paycheck schedule saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
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
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  function updateBill(id: string, patch: Partial<UpcomingBill>) {
    setBills(draftBills.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Month plan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {insights.monthLabel}. Paydays, dated bills, envelopes, and what each check covers.
        </p>
      </header>

      <LeftoverCard />

      <section className="rounded-3xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <Label htmlFor="checking">Checking</Label>
        <p className="text-xs text-muted-foreground">
          Already includes the {formatCents(state.paycheck.netCents)} paycheck just received.
        </p>
        <Input
          id="checking"
          inputMode="decimal"
          value={checkingValue}
          onChange={(e) => {
            setCheckingDirty(true);
            setChecking(e.target.value);
          }}
          className="mt-2 h-12 font-mono text-base"
        />
        <Button className="mt-3 h-12 w-full text-base" onClick={persistChecking} disabled={busy || !checkingDirty}>
          Save checking
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Calendar</h2>
        {months.map((key) => (
          <MonthGrid
            key={key}
            monthISO={`${key}-01`}
            events={insights.calendar.filter((e) => e.date.startsWith(key))}
            today={insights.todayISO}
          />
        ))}
        <div className="space-y-2">
          {insights.calendar
            .filter((e) => e.date >= insights.todayISO || e.kind === "payday")
            .slice(0, 10)
            .map((ev, i) => (
              <div
                key={`${ev.date}-${ev.label}-${i}`}
                className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10"
              >
                <div>
                  <p className="font-medium">{ev.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatLongDate(ev.date)}
                    {ev.kind === "payday" ? " · payday" : ev.paid ? " · paid" : " · due"}
                  </p>
                </div>
                <p className="font-mono text-sm">{formatCents(ev.cents)}</p>
              </div>
            ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">What each paycheck covers</h2>
        {insights.paycheckPlan.map((slice) => (
          <article
            key={slice.date}
            className={cn(
              "rounded-2xl px-4 py-4 ring-1 ring-foreground/10",
              slice.isCurrent ? "bg-card" : "bg-muted/40"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{slice.label}</p>
              {slice.isCurrent && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">Current</span>
              )}
            </div>
            <div className="mt-3">
              <FormulaBlock
                formula={slice.isCurrent ? insights.formulas.paycheck : insights.formulas.nextPaycheck}
                defaultOpen
              />
            </div>
          </article>
        ))}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Envelope remaining</h2>
        <div className="space-y-2">
          {insights.categories.map((c) => (
            <div key={c.id} className="rounded-2xl bg-card px-4 py-2 ring-1 ring-foreground/10">
              <FormulaBlock formula={insights.formulas[`envelope-${c.id}`]} defaultOpen={false} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Dated bills</h2>
        {draftBills.map((bill) => (
          <article key={bill.id} className="space-y-2 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
            <Input
              value={bill.name}
              onChange={(e) => updateBill(bill.id, { name: e.target.value })}
              className="h-11 border-0 bg-transparent px-0 text-base font-medium shadow-none focus-visible:ring-0"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                inputMode="decimal"
                value={dollarsField(bill.amountCents)}
                onChange={(e) =>
                  updateBill(bill.id, { amountCents: Math.max(0, dollarsToCents(e.target.value || "0")) })
                }
                className="h-12 font-mono"
                aria-label={`${bill.name} amount`}
              />
              <Input
                type="date"
                value={bill.dueDate}
                onChange={(e) => updateBill(bill.id, { dueDate: e.target.value })}
                className="h-12"
                aria-label={`${bill.name} due date`}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => updateBill(bill.id, { fromThisCheck: !bill.fromThisCheck })}
                className={cn(
                  "h-9 rounded-full px-3 text-xs font-medium",
                  bill.fromThisCheck ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {bill.fromThisCheck ? "From this paycheck" : "From next paycheck"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (bills) await persistBills();
                  await setBillPaid(bill.id, !bill.paid);
                  toast.success(bill.paid ? `${bill.name} marked unpaid.` : `Paid ${bill.name}.`);
                }}
                className={cn(
                  "h-9 rounded-full px-3 text-xs font-medium",
                  bill.paid ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                )}
              >
                {bill.paid ? "Paid" : "Mark paid"}
              </button>
            </div>
          </article>
        ))}
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
        <Button className="h-12 w-full text-base" onClick={persistBills} disabled={busy || !bills}>
          Save bills
        </Button>
      </section>

      <section className="space-y-3 rounded-3xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Paycheck</h2>
        <Label htmlFor="net">Net every two weeks</Label>
        <Input
          id="net"
          inputMode="decimal"
          value={netValue}
          onChange={(e) => {
            setPayDirty(true);
            setNet(e.target.value);
          }}
          className="h-12 font-mono text-base"
        />
        <Label htmlFor="anchor">A payday (repeats every 14 days)</Label>
        <Input
          id="anchor"
          type="date"
          value={anchorValue}
          onChange={(e) => {
            setPayDirty(true);
            setAnchor(e.target.value);
          }}
          className="h-12 text-base"
        />
        <Button className="h-12 w-full text-base" onClick={persistPay} disabled={busy || !payDirty}>
          Save paycheck
        </Button>
      </section>
    </div>
  );
}

function MonthGrid({
  monthISO,
  events,
  today,
}: {
  monthISO: string;
  events: { date: string; kind: string }[];
  today: string;
}) {
  const start = startOfMonth(monthISO);
  const dim = daysInMonth(monthISO);
  const firstWeekday = new Date(`${start}T12:00:00`).getDay();
  const cells: Array<string | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: dim }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      return `${start.slice(0, 7)}-${d}`;
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rounded-2xl bg-card px-3 py-3 ring-1 ring-foreground/10">
      <p className="mb-2 text-sm font-medium">{formatMonthLabel(monthISO)}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={`${d}-${i}`}>{d}</div>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <div key={`e-${i}`} />;
          const dayEvents = events.filter((e) => e.date === iso);
          const isToday = iso === today;
          return (
            <div
              key={iso}
              className={cn(
                "flex min-h-9 flex-col items-center justify-center rounded-lg text-xs",
                isToday && "bg-primary text-primary-foreground",
                !isToday && dayEvents.length > 0 && "bg-muted"
              )}
              title={dayEvents.map((e) => e.kind).join(", ")}
            >
              {Number(iso.slice(8))}
              {dayEvents.length > 0 && (
                <span className={cn("mt-0.5 size-1 rounded-full", isToday ? "bg-primary-foreground" : "bg-primary")} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
