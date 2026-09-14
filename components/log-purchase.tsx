"use client";

import { useEffect, useMemo, useState } from "react";
import { Delete, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { suggestCategory } from "@/lib/categorize";
import { formatCents } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import type { CategoryId } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useDolla } from "./dolla-provider";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

export function LogPurchaseDrawer() {
  const { logOpen, setLogOpen, logPurchase, state, insights } = useDolla();
  const [digits, setDigits] = useState("");
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState<CategoryId>("misc");
  const [autoCategory, setAutoCategory] = useState(true);
  const [saving, setSaving] = useState(false);

  const amountCents = Number.parseInt(digits || "0", 10);
  const suggested = useMemo(
    () => suggestCategory(merchant, state?.merchantRules ?? {}),
    [merchant, state?.merchantRules]
  );

  useEffect(() => {
    if (logOpen) {
      setDigits("");
      setMerchant("");
      setNote("");
      setDate(todayISO());
      setCategoryId("misc");
      setAutoCategory(true);
    }
  }, [logOpen]);

  useEffect(() => {
    if (autoCategory) setCategoryId(suggested.categoryId);
  }, [autoCategory, suggested.categoryId]);

  async function submit() {
    if (amountCents <= 0) {
      toast.error("Enter an amount.");
      return;
    }
    if (!merchant.trim()) {
      toast.error("Who did you pay?");
      return;
    }
    setSaving(true);
    try {
      await logPurchase({
        amountCents,
        merchant: merchant.trim(),
        note,
        categoryId,
        date,
      });
      const cat = state?.categories.find((c) => c.id === categoryId)?.name ?? categoryId;
      toast.success(`Logged ${formatCents(amountCents)} at ${merchant.trim()}`, {
        description: cat,
      });
      setLogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not log that.");
    } finally {
      setSaving(false);
    }
  }

  function tap(key: (typeof KEYS)[number]) {
    if (key === "") return;
    if (key === "del") {
      setDigits((d) => d.slice(0, -1));
      return;
    }
    setDigits((d) => {
      if (d.length >= 7) return d;
      if (d === "0") return key;
      return d + key;
    });
  }

  const remaining = insights?.categories.find((c) => c.id === categoryId)?.remainingCents;
  const fitsToday = insights ? amountCents <= insights.safeToSpendTodayCents : true;
  const fitsChecking = insights ? amountCents <= insights.leftoverCheckingCents : true;

  return (
    <Drawer open={logOpen} onOpenChange={setLogOpen} showSwipeHandle>
      <DrawerContent className="max-w-lg mx-auto">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-xl">Log a purchase</DrawerTitle>
          <DrawerDescription>
            Amount, who, done. Category fills itself from the merchant. To import a statement,{" "}
            <Link
              href="/profile"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => setLogOpen(false)}
            >
              paste or upload a CSV on Profile
            </Link>
            .
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-2">
          <p className="py-2 text-center font-mono text-5xl font-semibold tracking-tight">
            {formatCents(amountCents)}
          </p>
          {amountCents > 0 && insights && (
            <p
              className={cn(
                "mb-2 text-center text-sm",
                remaining !== undefined && remaining - amountCents < 0
                  ? "text-destructive"
                  : fitsToday
                    ? "text-primary"
                    : "text-amber-400"
              )}
            >
              {remaining !== undefined && remaining - amountCents < 0
                ? `Puts ${state?.categories.find((c) => c.id === categoryId)?.name} over by ${formatCents(amountCents - remaining)}`
                : fitsToday
                  ? "Fits today’s pace"
                  : fitsChecking
                    ? "Fits leftover checking, not today’s pace"
                    : "More than leftover checking after holdbacks"}
            </p>
          )}

          <div className="grid grid-cols-3 gap-2 py-2">
            {KEYS.map((key, i) => (
              <button
                key={`${key}-${i}`}
                type="button"
                disabled={key === ""}
                onClick={() => tap(key)}
                className={cn(
                  "h-14 rounded-2xl text-2xl font-medium active:bg-muted",
                  key === "" && "opacity-0"
                )}
              >
                {key === "del" ? <Delete className="mx-auto size-6" /> : key}
              </button>
            ))}
          </div>

          <div className="space-y-3 pt-1">
            <div>
              <Label htmlFor="merchant" className="text-sm">
                Merchant
              </Label>
              <Input
                id="merchant"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="Whole Foods, Uber, ComEd…"
                autoComplete="off"
                autoCorrect="off"
                className="mt-1 h-12 text-base"
              />
            </div>
            <div>
              <Label className="text-sm">Category</Label>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {state?.categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setCategoryId(cat.id);
                      setAutoCategory(false);
                    }}
                    className={cn(
                      "h-10 shrink-0 rounded-full px-3 text-sm font-medium",
                      categoryId === cat.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {autoCategory
                  ? suggested.source === "rule"
                    ? "Using your last category for this merchant."
                    : suggested.source === "heuristic"
                      ? "Guessed from the name. Tap another category to teach Dolla."
                      : "Couldn’t guess — pick a category."
                  : "Saved. Next time this merchant goes here."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="date" className="text-sm">
                  Date
                </Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  max={todayISO()}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 h-12 text-base"
                />
              </div>
              <div>
                <Label htmlFor="note" className="text-sm">
                  Note
                </Label>
                <Input
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 h-12 text-base"
                />
              </div>
            </div>
          </div>
        </div>
        <DrawerFooter>
          <Button
            size="lg"
            className="h-12 w-full text-base"
            onClick={submit}
            disabled={saving}
          >
            {saving ? <Loader2 className="size-5 animate-spin" /> : `Log ${formatCents(amountCents)}`}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
